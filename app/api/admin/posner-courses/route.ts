import { desc, eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { learningResources } from "../../../../db/schema";
import { requireAdmin } from "../../../../lib/member-auth";

export async function GET(request: Request) {
  const auth = await requireAdmin(request);
  if ("error" in auth) return auth.error;
  const courses = await auth.db.select({ id: learningResources.id, title: learningResources.title, subject: learningResources.subject, creator: learningResources.creator, description: learningResources.description, status: learningResources.status, accessType: learningResources.accessType, sourceUrl: learningResources.sourceUrl, hasCover: learningResources.coverStorageKey }).from(learningResources).where(eq(learningResources.resourceType, "course")).orderBy(desc(learningResources.createdAt));
  return Response.json({ courses }, { headers: { "cache-control": "no-store" } });
}

export async function PUT(request: Request) {
  const auth = await requireAdmin(request);
  if ("error" in auth) return auth.error;
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const id = Number(body.id), title = String(body.title ?? "").trim();
  if (!id || !title) return Response.json({ error: "請選擇影片並填寫課程名稱" }, { status: 400 });
  const [current] = await auth.db.select().from(learningResources).where(eq(learningResources.id, id)).limit(1);
  if (!current || current.resourceType !== "course") return Response.json({ error: "找不到影音課程" }, { status: 404 });
  const published = body.published === true;
  if (published && !current.sourceUrl.trim()) return Response.json({ error: "影片尚未處理完成，暫時不能發布" }, { status: 409 });
  const [course] = await auth.db.update(learningResources).set({ title: title.slice(0, 180), creator: String(body.creator ?? "陳友心").trim().slice(0, 100), subject: String(body.subject ?? "主題講座").trim().slice(0, 100), description: String(body.description ?? "").trim().slice(0, 3000), accessType: published ? "posner" : current.accessType === "posner" ? "owned" : current.accessType, status: published ? "active" : "draft", updatedAt: new Date() }).where(eq(learningResources.id, id)).returning();
  return Response.json({ course });
}

export async function POST(request: Request) {
  const auth = await requireAdmin(request);
  if ("error" in auth) return auth.error;
  const form = await request.formData();
  const id = Number(form.get("id")), file = form.get("file");
  if (!id || !(file instanceof File)) return Response.json({ error: "請選擇課程與縮圖" }, { status: 400 });
  if (!file.type.startsWith("image/") || file.size > 8 * 1024 * 1024) return Response.json({ error: "縮圖必須是 8MB 以下的圖片" }, { status: 400 });
  const db = await getDb();
  const [course] = await db.select().from(learningResources).where(eq(learningResources.id, id)).limit(1);
  if (!course || course.resourceType !== "course") return Response.json({ error: "找不到影音課程" }, { status: 404 });
  const { env } = await import("cloudflare:workers");
  const key = `posner/course-covers/${id}-${Date.now()}`;
  await env.BUCKET.put(key, file.stream(), { httpMetadata: { contentType: file.type }, customMetadata: { originalName: file.name } });
  if (course.coverStorageKey) await env.BUCKET.delete(course.coverStorageKey);
  await db.update(learningResources).set({ coverStorageKey: key, updatedAt: new Date() }).where(eq(learningResources.id, id));
  return Response.json({ ok: true });
}
