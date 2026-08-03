import { desc, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "../../../db";
import { learningResources, resourceSegments } from "../../../db/schema";

export async function GET() {
  const db = await getDb();
  const rows = await db
    .select({
      id: learningResources.id,
      resourceType: learningResources.resourceType,
      title: learningResources.title,
      subject: learningResources.subject,
      creator: learningResources.creator,
      description: learningResources.description,
      documentId: learningResources.documentId,
      linkedBookId: learningResources.linkedBookId,
      sourceUrl: learningResources.sourceUrl,
      accessType: learningResources.accessType,
      status: learningResources.status,
      hasCover: sql<number>`case when ${learningResources.coverStorageKey} is null then 0 else 1 end`,
      segmentCount: sql<number>`count(${resourceSegments.id})`,
      updatedAt: learningResources.updatedAt,
    })
    .from(learningResources)
    .leftJoin(
      resourceSegments,
      eq(resourceSegments.resourceId, learningResources.id),
    )
    .groupBy(learningResources.id)
    .orderBy(desc(learningResources.updatedAt));
  const articleRows = await db
    .select({ resourceId: resourceSegments.resourceId, id: resourceSegments.id, title: resourceSegments.title, text: resourceSegments.text, summary: resourceSegments.summary, reviewStatus: resourceSegments.reviewStatus, segmentType: resourceSegments.segmentType, sequence: resourceSegments.sequence })
    .from(resourceSegments)
    .where(inArray(resourceSegments.segmentType, ["article_trial", "article_link", "article"]))
    .orderBy(resourceSegments.sequence);
  const articlesByResource = new Map<number, typeof articleRows>();
  for (const article of articleRows) {
    const current = articlesByResource.get(article.resourceId) ?? [];
    current.push(article);
    articlesByResource.set(article.resourceId, current);
  }
  return Response.json({ resources: rows.map((row) => ({ ...row, articlePreviews: (articlesByResource.get(row.id) ?? []).slice(0, 4).map((article) => { let failure = ""; if (article.segmentType === "article_link") { try { failure = String((JSON.parse(article.text) as { error?: string }).error ?? article.summary ?? "試讀 PDF 尚未完成分析"); } catch { failure = article.summary || "試讀 PDF 尚未完成分析"; } } return { id: article.id, title: article.title, summary: article.summary, reviewStatus: article.reviewStatus, segmentType: article.segmentType, sequence: article.sequence, failure }; }) })) });
}

export async function POST(request: Request) {
  const body = (await request.json()) as Record<string, unknown>;
  const title = String(body.title ?? "").trim();
  const resourceType = String(body.resourceType ?? "book");
  if (!title || !["book", "course", "magazine"].includes(resourceType))
    return Response.json(
      { error: "請填寫正確的資源名稱與類型" },
      { status: 400 },
    );
  const db = await getDb();
  const [row] = await db
    .insert(learningResources)
    .values({
      resourceType,
      title,
      subject: String(body.subject ?? "刑法"),
      creator: String(body.creator ?? ""),
      description: String(body.description ?? ""),
      documentId: Number(body.documentId) || null,
      linkedBookId:
        resourceType === "course" ? Number(body.linkedBookId) || null : null,
      sourceUrl: String(body.sourceUrl ?? ""),
      accessType: String(body.accessType ?? "owned"),
      status: String(body.status ?? "active"),
    })
    .returning();
  return Response.json({ resource: row }, { status: 201 });
}

export async function PUT(request: Request) {
  const body = (await request.json()) as Record<string, unknown>;
  const id = Number(body.id);
  if (!id) return Response.json({ error: "缺少資源編號" }, { status: 400 });
  const db = await getDb();
  const [row] = await db
    .update(learningResources)
    .set({
      title: String(body.title ?? "").trim(),
      subject: String(body.subject ?? "刑法"),
      creator: String(body.creator ?? ""),
      description: String(body.description ?? ""),
      documentId: Number(body.documentId) || null,
      linkedBookId: Number(body.linkedBookId) || null,
      sourceUrl: String(body.sourceUrl ?? ""),
      accessType: String(body.accessType ?? "owned"),
      status: String(body.status ?? "active"),
      updatedAt: new Date(),
    })
    .where(eq(learningResources.id, id))
    .returning();
  return Response.json({ resource: row });
}

export async function DELETE(request: Request) {
  const id = Number(new URL(request.url).searchParams.get("id"));
  if (!id) return Response.json({ error: "缺少資源編號" }, { status: 400 });
  const db = await getDb();
  const [resource] = await db
    .select()
    .from(learningResources)
    .where(eq(learningResources.id, id))
    .limit(1);
  if (!resource) return Response.json({ error: "找不到資源" }, { status: 404 });
  await db.delete(learningResources).where(eq(learningResources.id, id));
  if (resource.coverStorageKey) {
    const { env } = await import("cloudflare:workers");
    await env.BUCKET.delete(resource.coverStorageKey);
  }
  return Response.json({ ok: true });
}
