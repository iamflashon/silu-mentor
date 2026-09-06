import { asc, desc, eq, inArray } from "drizzle-orm";
import { pengliStudyArtifacts, pengliStudyAudioSegments } from "../../../../db/schema";
import { requireAdmin } from "../../../../lib/member-auth";

export async function GET(request: Request) {
  const auth = await requireAdmin(request);
  if ("error" in auth) return auth.error;
  const rows = await auth.db.select().from(pengliStudyArtifacts)
    .orderBy(desc(pengliStudyArtifacts.updatedAt)).limit(200);
  const audioIds = rows.filter((row) => row.tool === "audio").map((row) => row.id);
  const segments = audioIds.length ? await auth.db.select().from(pengliStudyAudioSegments).where(inArray(pengliStudyAudioSegments.artifactId, audioIds)).orderBy(asc(pengliStudyAudioSegments.position)) : [];
  return Response.json({ rows: rows.map((row) => ({ ...row, audioSegments: segments.filter((segment) => segment.artifactId === row.id).map((segment) => ({ ...segment, audioUrl: segment.audioStorageKey ? `/api/admin/pengli-study-artifacts/audio?segmentId=${segment.id}` : null })) })) });
}

export async function PATCH(request: Request) {
  const auth = await requireAdmin(request);
  if ("error" in auth) return auth.error;
  const body = await request.json() as { id?: number; ids?: number[]; segmentId?: number; action?: "publish" | "unpublish" | "edit" | "edit-audio-segment"; content?: string; title?: string; sourceLabel?: string };
  if (body.action === "edit-audio-segment") {
    const segmentId = Number(body.segmentId);
    if (!Number.isInteger(segmentId) || !body.title?.trim() || !body.content?.trim()) return Response.json({ error: "請填寫段落標題與純語音稿。" }, { status: 400 });
    const [current] = await auth.db.select().from(pengliStudyAudioSegments).where(eq(pengliStudyAudioSegments.id, segmentId)).limit(1);
    if (!current) return Response.json({ error: "找不到這一段語音稿。" }, { status: 404 });
    const scriptChanged = current.script.trim() !== body.content.trim();
    const [row] = await auth.db.update(pengliStudyAudioSegments).set({ title: body.title.trim(), script: body.content.trim(), ...(scriptChanged ? { audioStorageKey: null, audioFileName: null, audioContentType: null, audioSizeBytes: null } : {}), updatedAt: new Date() }).where(eq(pengliStudyAudioSegments.id, segmentId)).returning();
    await auth.db.update(pengliStudyArtifacts).set({ reviewStatus: "pending_review", updatedAt: new Date() }).where(eq(pengliStudyArtifacts.id, current.artifactId));
    if (scriptChanged && current.audioStorageKey) { const { env } = await import("cloudflare:workers"); await env.BUCKET?.delete(current.audioStorageKey).catch(() => undefined); }
    return Response.json({ row, updatedCount: 1 });
  }
  const ids = normalizeIds(body.ids || (body.id ? [body.id] : []));
  if (!ids.length || !body.action) return Response.json({ error: "缺少成果或操作。" }, { status: 400 });
  if (body.action === "edit") {
    if (ids.length !== 1 || !body.content?.trim()) return Response.json({ error: "請提供一筆成果及完整內容。" }, { status: 400 });
    const [current] = await auth.db.select().from(pengliStudyArtifacts).where(eq(pengliStudyArtifacts.id, ids[0])).limit(1);
    if (!current) return Response.json({ error: "找不到這筆學習成果。" }, { status: 404 });
    const [row] = await auth.db.update(pengliStudyArtifacts)
      .set({ content: body.content.trim(), sourceLabel: body.sourceLabel?.trim() || "教材內容", reviewStatus: "pending_review", ...(current.tool === "audio" ? { audioStorageKey: null, audioFileName: null, audioContentType: null, audioSizeBytes: null } : {}), updatedAt: new Date() })
      .where(eq(pengliStudyArtifacts.id, ids[0])).returning();
    if (current.tool === "audio" && current.audioStorageKey) {
      const { env } = await import("cloudflare:workers");
      await env.BUCKET?.delete(current.audioStorageKey).catch(() => undefined);
    }
    return Response.json({ row, updatedCount: 1 });
  }
  if (body.action === "publish") {
    const candidates = await auth.db.select({ tool: pengliStudyArtifacts.tool, topic: pengliStudyArtifacts.topic, audioStorageKey: pengliStudyArtifacts.audioStorageKey }).from(pengliStudyArtifacts).where(inArray(pengliStudyArtifacts.id, ids));
    const audioCandidates = candidates.filter((row) => row.tool === "audio");
    if (audioCandidates.length) {
      const segments = await auth.db.select().from(pengliStudyAudioSegments).where(inArray(pengliStudyAudioSegments.artifactId, audioCandidates.map((row) => row.id)));
      const incompleteAudio = audioCandidates.find((row) => { const own = segments.filter((segment) => segment.artifactId === row.id); return !own.length || own.some((segment) => !segment.audioStorageKey); });
      if (incompleteAudio) return Response.json({ error: `「${incompleteAudio.topic}」仍有段落尚未上傳語音成品，不能發布到學生前台。` }, { status: 409 });
    }
  }
  const reviewStatus = body.action === "publish" ? "published" : "pending_review";
  const rows = await auth.db.update(pengliStudyArtifacts)
    .set({ reviewStatus, updatedAt: new Date() })
    .where(inArray(pengliStudyArtifacts.id, ids)).returning();
  if (!rows.length) return Response.json({ error: "找不到所選學習成果。" }, { status: 404 });
  return Response.json({ rows, updatedCount: rows.length });
}

export async function DELETE(request: Request) {
  const auth = await requireAdmin(request);
  if ("error" in auth) return auth.error;
  const body = await request.json() as { ids?: number[] };
  const ids = normalizeIds(body.ids || []);
  if (!ids.length) return Response.json({ error: "請先選擇要刪除的成果。" }, { status: 400 });
  const audioRows = await auth.db.select({ audioStorageKey: pengliStudyArtifacts.audioStorageKey }).from(pengliStudyArtifacts).where(inArray(pengliStudyArtifacts.id, ids));
  const audioSegments = await auth.db.select({ audioStorageKey: pengliStudyAudioSegments.audioStorageKey }).from(pengliStudyAudioSegments).where(inArray(pengliStudyAudioSegments.artifactId, ids));
  const rows = await auth.db.delete(pengliStudyArtifacts).where(inArray(pengliStudyArtifacts.id, ids)).returning({ id: pengliStudyArtifacts.id });
  const { env } = await import("cloudflare:workers");
  for (const row of audioRows) if (row.audioStorageKey) await env.BUCKET?.delete(row.audioStorageKey).catch(() => undefined);
  for (const row of audioSegments) if (row.audioStorageKey) await env.BUCKET?.delete(row.audioStorageKey).catch(() => undefined);
  return Response.json({ deletedCount: rows.length });
}

function normalizeIds(values: number[]) {
  return [...new Set(values.map(Number).filter((id) => Number.isInteger(id) && id > 0))].slice(0, 200);
}
