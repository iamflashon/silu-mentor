import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "../../../db";
import { appSettings, documents, learningResources, resourceSegments } from "../../../db/schema";

function isPlayableCourseUrl(value: string) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return false;
    return /\.(?:m3u8|mp4|webm|ogg|m4v)(?:[?#].*)?$/i.test(url.pathname + url.search)
      || url.hostname === "youtu.be"
      || url.hostname === "youtube.com"
      || url.hostname.endsWith(".youtube.com");
  } catch {
    return false;
  }
}

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
      documentStatus: documents.status,
      documentError: documents.indexError,
      hasCover: sql<number>`case when ${learningResources.coverStorageKey} is null then 0 else 1 end`,
      segmentCount: sql<number>`count(${resourceSegments.id})`,
      chapterCount: sql<number>`sum(case when ${resourceSegments.segmentType} in ('book_chapter', 'chapter', 'book_outline') then 1 else 0 end)`,
      updatedAt: learningResources.updatedAt,
    })
    .from(learningResources)
    .leftJoin(
      resourceSegments,
      eq(resourceSegments.resourceId, learningResources.id),
    )
    .leftJoin(documents, eq(learningResources.documentId, documents.id))
    .groupBy(learningResources.id, documents.status, documents.indexError)
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
  return Response.json({
    resources: rows.map((row) => {
      const articles = (articlesByResource.get(row.id) ?? []).slice(0, 4);
      const articlePreviews = articles.map((article) => {
        let failure = "";
        let sourceUrl = "";
        if (article.segmentType === "article_link") {
          try {
            const source = JSON.parse(article.text) as {
              error?: string;
              url?: string;
            };
            failure = source.error ?? article.summary ?? "";
            sourceUrl = source.url ?? "";
          } catch {
            failure = article.summary || "";
          }
        }
        const textLength = article.segmentType === "article_link" ? 0 : article.text.trim().length;
        const analysisState = article.reviewStatus === "ai_reviewed" && (textLength > 0 || article.summary.trim().length > 0)
          ? "analyzed"
          : article.reviewStatus === "failed"
            ? "failed"
            : textLength > 0
              ? "captured"
              : "pending";
        return {
          id: article.id,
          title: article.title,
          summary: article.summary,
          reviewStatus: article.reviewStatus,
          segmentType: article.segmentType,
          sequence: article.sequence,
          failure,
          sourceUrl,
          textLength,
          analysisState,
        };
      });
      const analyzedArticleCount = articlePreviews.filter((article) => article.analysisState === "analyzed").length;
      const failedArticleCount = articlePreviews.filter((article) => article.analysisState === "failed").length;
      return {
        ...row,
        articlePreviews,
        articleCount: articlePreviews.length,
        analyzedArticleCount,
        failedArticleCount,
        pendingArticleCount: articlePreviews.length - analyzedArticleCount - failedArticleCount,
      };
    }),
  });
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
  const sourceUrl = String(body.sourceUrl ?? "").trim();
  if (resourceType === "course" && sourceUrl && !isPlayableCourseUrl(sourceUrl))
    return Response.json(
      { error: "影音課程請填寫可直接播放的 HLS（.m3u8）或影片網址；ibrain 課程頁網址不能直接嵌入播放器。" },
      { status: 422 },
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
      sourceUrl,
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
  const [current] = await db.select().from(learningResources).where(eq(learningResources.id, id)).limit(1);
  if (!current) return Response.json({ error: "找不到資源" }, { status: 404 });
  const hasDocumentId = Object.prototype.hasOwnProperty.call(body, "documentId");
  const hasLinkedBookId = Object.prototype.hasOwnProperty.call(body, "linkedBookId");
  const nextDocumentId = hasDocumentId ? Number(body.documentId) || null : current.documentId;
  const nextSourceUrl = String(body.sourceUrl ?? "").trim();
  if (current.resourceType === "course" && nextSourceUrl && !isPlayableCourseUrl(nextSourceUrl))
    return Response.json(
      { error: "影音課程請填寫可直接播放的 HLS（.m3u8）或影片網址；ibrain 課程頁網址不能直接嵌入播放器。" },
      { status: 422 },
    );
  if (current.resourceType === "book" && current.documentId !== nextDocumentId) {
    await db.delete(resourceSegments).where(and(
      eq(resourceSegments.resourceId, id),
      inArray(resourceSegments.segmentType, ["book_chapter", "chapter", "book_outline"]),
    ));
    await db.delete(appSettings).where(eq(appSettings.key, `book_chapters_status:${id}`));
  }
  const [row] = await db
    .update(learningResources)
    .set({
      title: String(body.title ?? "").trim(),
      subject: String(body.subject ?? "刑法"),
      creator: String(body.creator ?? ""),
      description: String(body.description ?? ""),
      documentId: nextDocumentId,
      linkedBookId: hasLinkedBookId ? Number(body.linkedBookId) || null : current.linkedBookId,
      sourceUrl: nextSourceUrl,
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
