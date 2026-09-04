import { and, desc, eq, sql } from "drizzle-orm";
import { getDb } from "../../../../db";
import { learningResources, posnerCourseProducts, posnerCourseVouchers, resourceSegments } from "../../../../db/schema";
import { linePayConfig } from "../../../../lib/line-pay";
import { requireAdmin } from "../../../../lib/member-auth";
import { readLocalNodeJobs } from "../../../../lib/local-node-jobs";

export async function GET(request: Request) {
  const auth = await requireAdmin(request);
  if ("error" in auth) return auth.error;
  const rows = await auth.db.select({ id: learningResources.id, title: learningResources.title, subject: learningResources.subject, creator: learningResources.creator, description: learningResources.description, status: learningResources.status, accessType: learningResources.accessType, sourceUrl: learningResources.sourceUrl, hasCover: learningResources.coverStorageKey, price: posnerCourseProducts.price, accessDays: posnerCourseProducts.accessDays, previewStartSeconds: posnerCourseProducts.previewStartSeconds, previewDurationSeconds: posnerCourseProducts.previewDurationSeconds, salesEnabled: posnerCourseProducts.salesEnabled }).from(learningResources).leftJoin(posnerCourseProducts, eq(posnerCourseProducts.resourceId, learningResources.id)).where(eq(learningResources.resourceType, "course")).orderBy(desc(learningResources.createdAt));
  const [jobs, summaryRows] = await Promise.all([readLocalNodeJobs(), auth.db.select({ resourceId: resourceSegments.resourceId }).from(resourceSegments).where(eq(resourceSegments.reviewStatus, "ai_digest"))]);
  const summaryIds = new Set(summaryRows.map((row) => row.resourceId));
  const config = await linePayConfig();
  return Response.json({ courses: rows.map(row => { const job = jobs.find((item) => item.resourceId === row.id && item.kind === "transcode_video" && item.status === "completed"); return ({...row, price: row.price ?? 0, accessDays: row.accessDays ?? 365, previewStartSeconds: row.previewStartSeconds ?? 0, previewDurationSeconds: row.previewDurationSeconds ?? 300, salesEnabled: row.salesEnabled ?? false, hlsReady: Boolean(job?.hlsKey), subtitleReady: Boolean(job?.subtitleKey), summaryReady: summaryIds.has(row.id), mediaMessage: job?.message ?? "尚未完成影音處理"}); }), linePay: { environment: config.environment, configured: Boolean(config.channelId && config.channelSecret) } }, { headers: { "cache-control": "no-store" } });
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
  const price = Math.max(0, Math.floor(Number(body.price) || 0));
  const accessDays = Math.max(1, Math.min(3650, Math.floor(Number(body.accessDays) || 365)));
  const previewStartSeconds = Math.max(0, Math.floor(Number(body.previewStartSeconds) || 0));
  const previewDurationSeconds = Math.max(0, Math.min(7200, Math.floor(Number(body.previewDurationSeconds) || 0)));
  const salesEnabled = body.salesEnabled === true;
  if (salesEnabled && price < 1) return Response.json({ error: "開放購買前請設定售價" }, { status: 400 });
  if (published) {
    const jobs = await readLocalNodeJobs();
    const ready = jobs.some((item) => item.resourceId === id && item.kind === "transcode_video" && item.status === "completed" && item.hlsKey);
    if (!ready) return Response.json({ error: "HLS 尚未完成上傳及播放檢查，暫時不能發布" }, { status: 409 });
  }
  const [course] = await auth.db.update(learningResources).set({ title: title.slice(0, 180), creator: String(body.creator ?? "陳友心").trim().slice(0, 100), subject: String(body.subject ?? "主題講座").trim().slice(0, 100), description: String(body.description ?? "").trim().slice(0, 3000), accessType: published ? "posner" : current.accessType === "posner" ? "owned" : current.accessType, status: published ? "active" : "draft", updatedAt: new Date() }).where(eq(learningResources.id, id)).returning();
  await auth.db.insert(posnerCourseProducts).values({resourceId:id,price,accessDays,previewStartSeconds,previewDurationSeconds,salesEnabled,updatedAt:new Date()}).onConflictDoUpdate({target:posnerCourseProducts.resourceId,set:{price,accessDays,previewStartSeconds,previewDurationSeconds,salesEnabled,updatedAt:new Date()}});
  return Response.json({ course });
}

export async function PATCH(request: Request) {
  const auth = await requireAdmin(request); if ("error" in auth) return auth.error;
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const resourceId = Number(body.id);
  if (!resourceId) return Response.json({error:"請選擇課程"},{status:400});
  if (body.action === "recommend-preview") {
    const [segment] = await auth.db.select({startSeconds:resourceSegments.startSeconds,title:resourceSegments.title,summary:resourceSegments.summary}).from(resourceSegments).where(and(eq(resourceSegments.resourceId,resourceId),eq(resourceSegments.segmentType,"subtitle"))).orderBy(desc(resourceSegments.recommended),desc(resourceSegments.importance),sql`length(${resourceSegments.summary}) desc`).limit(1);
    if (!segment?.startSeconds) return Response.json({error:"這門課尚無可推薦的摘要時間點"},{status:404});
    return Response.json({startSeconds:segment.startSeconds,title:segment.title||"AI 推薦重點",summary:segment.summary});
  }
  if (body.action === "create-voucher") {
    const accessDays=Math.max(1,Math.min(3650,Math.floor(Number(body.accessDays)||365)));
    const custom=String(body.code??"").trim().toUpperCase().replace(/[^A-Z0-9-]/g,"");
    const code=custom||`POS-${crypto.randomUUID().replaceAll("-","").slice(0,4).toUpperCase()}-${crypto.randomUUID().replaceAll("-","").slice(0,4).toUpperCase()}`;
    await auth.db.insert(posnerCourseVouchers).values({resourceId,code,accessDays});
    return Response.json({code});
  }
  return Response.json({error:"不支援的操作"},{status:400});
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
