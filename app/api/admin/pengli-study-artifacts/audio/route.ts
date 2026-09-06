import { eq } from "drizzle-orm";
import { pengliStudyArtifacts } from "../../../../../db/schema";
import { requireAdmin } from "../../../../../lib/member-auth";

const allowed = new Set(["audio/mpeg", "audio/mp4", "audio/wav", "audio/ogg", "audio/aac", "audio/webm"]);

export async function POST(request: Request) {
  const auth = await requireAdmin(request);
  if ("error" in auth) return auth.error;
  const form = await request.formData();
  const id = Number(form.get("id"));
  const file = form.get("file");
  if (!Number.isInteger(id) || id < 1 || !(file instanceof File)) return Response.json({ error: "請選擇正確的語音成果。" }, { status: 400 });
  if (!allowed.has(file.type) || file.size > 120 * 1024 * 1024) return Response.json({ error: "請上傳 120MB 以下的 MP3、M4A、WAV、OGG、AAC 或 WebM 音檔。" }, { status: 400 });
  const [artifact] = await auth.db.select().from(pengliStudyArtifacts).where(eq(pengliStudyArtifacts.id, id)).limit(1);
  if (!artifact || artifact.tool !== "audio") return Response.json({ error: "找不到這筆通勤語音摘要。" }, { status: 404 });
  const extension = file.name.split(".").pop()?.replace(/[^a-z0-9]/giu, "").slice(0, 8) || "mp3";
  const storageKey = `pengli/study-audio/${id}-${crypto.randomUUID()}.${extension}`;
  const { env } = await import("cloudflare:workers");
  if (!env.BUCKET) return Response.json({ error: "音檔儲存空間尚未就緒。" }, { status: 503 });
  await env.BUCKET.put(storageKey, file.stream(), { httpMetadata: { contentType: file.type }, customMetadata: { artifactId: String(id), originalName: file.name } });
  await auth.db.update(pengliStudyArtifacts).set({ audioStorageKey: storageKey, audioFileName: file.name, audioContentType: file.type, audioSizeBytes: file.size, updatedAt: new Date() }).where(eq(pengliStudyArtifacts.id, id));
  if (artifact.audioStorageKey) await env.BUCKET.delete(artifact.audioStorageKey).catch(() => undefined);
  return Response.json({ ok: true, audioFileName: file.name });
}

export async function DELETE(request: Request) {
  const auth = await requireAdmin(request);
  if ("error" in auth) return auth.error;
  const id = Number(new URL(request.url).searchParams.get("id"));
  const [artifact] = await auth.db.select().from(pengliStudyArtifacts).where(eq(pengliStudyArtifacts.id, id)).limit(1);
  if (!artifact) return Response.json({ error: "找不到這筆成果。" }, { status: 404 });
  const { env } = await import("cloudflare:workers");
  if (artifact.audioStorageKey) await env.BUCKET?.delete(artifact.audioStorageKey).catch(() => undefined);
  await auth.db.update(pengliStudyArtifacts).set({ audioStorageKey: null, audioFileName: null, audioContentType: null, audioSizeBytes: null, updatedAt: new Date() }).where(eq(pengliStudyArtifacts.id, id));
  return Response.json({ ok: true });
}
