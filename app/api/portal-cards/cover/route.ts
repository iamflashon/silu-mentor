import { eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { appSettings } from "../../../../db/schema";
import { requireAdmin } from "../../../../lib/member-auth";

const ids = new Set(["pengli", "medtech", "accounting"]);
const allowed = new Set(["image/jpeg", "image/png", "image/webp"]);
const keyFor = (id: string) => `homepage_card_cover:${id}`;

export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get("id") ?? "";
  if (!ids.has(id)) return new Response("not found", { status: 404 });
  const db = await getDb();
  const [row] = await db.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, keyFor(id))).limit(1);
  if (!row?.value) return new Response("not found", { status: 404 });
  const { env } = await import("cloudflare:workers");
  const object = await env.BUCKET.get(row.value);
  if (!object) return new Response("not found", { status: 404 });
  const headers = new Headers(); object.writeHttpMetadata(headers); headers.set("etag", object.httpEtag); headers.set("cache-control", "public, max-age=300");
  return new Response(object.body, { headers });
}

export async function POST(request: Request) {
  const auth = await requireAdmin(request); if ("error" in auth) return auth.error;
  const form = await request.formData(), id = String(form.get("id") ?? ""), file = form.get("file");
  if (!ids.has(id)) return Response.json({ error: "卡片資料不完整" }, { status: 400 });
  if (!(file instanceof File) || !allowed.has(file.type)) return Response.json({ error: "請上傳 JPG、PNG 或 WebP 書封" }, { status: 400 });
  if (file.size > 8 * 1024 * 1024) return Response.json({ error: "書封不可超過 8MB" }, { status: 413 });
  const db = await getDb(), settingKey = keyFor(id);
  const [old] = await db.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, settingKey)).limit(1);
  const ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
  const storageKey = `homepage/card-covers/${id}-${crypto.randomUUID()}.${ext}`;
  const { env } = await import("cloudflare:workers");
  await env.BUCKET.put(storageKey, file.stream(), { httpMetadata: { contentType: file.type } });
  await db.insert(appSettings).values({ key: settingKey, value: storageKey, updatedAt: new Date() }).onConflictDoUpdate({ target: appSettings.key, set: { value: storageKey, updatedAt: new Date() } });
  if (old?.value) await env.BUCKET.delete(old.value);
  return Response.json({ ok: true, coverUrl: `/api/portal-cards/cover?id=${id}&v=${Date.now()}` });
}
