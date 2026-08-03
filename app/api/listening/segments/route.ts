import { asc, eq, max } from "drizzle-orm";
import { getDb } from "../../../../db";
import { listeningAudioSegments, listeningSolutions, listeningSubtitleCues } from "../../../../db/schema";

function timeToSeconds(value: string) {
  const match = value.trim().replace(".", ",").match(/(\d+):(\d+):(\d+),(\d+)/);
  if (!match) return 0;
  return Math.round(Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) + Number(match[4]) / 1000);
}

function parseSrt(value: string) {
  return value.replace(/\r/g, "").trim().split(/\n\s*\n/).flatMap((block, sequence) => {
    const lines = block.split("\n"); const timingIndex = lines.findIndex((line) => line.includes("-->"));
    if (timingIndex < 0) return [];
    const [start, end] = lines[timingIndex].split("-->");
    return [{ sequence, startSeconds: timeToSeconds(start), endSeconds: timeToSeconds(end), text: lines.slice(timingIndex + 1).join(" ").trim() }];
  }).filter((cue) => cue.text);
}

export async function GET(request: Request) {
  const listeningId = Number(new URL(request.url).searchParams.get("listeningId"));
  const db = await getDb();
  const [segments, cues] = await Promise.all([
    db.select().from(listeningAudioSegments).where(eq(listeningAudioSegments.listeningId, listeningId)).orderBy(asc(listeningAudioSegments.sequence)),
    db.select().from(listeningSubtitleCues).where(eq(listeningSubtitleCues.listeningId, listeningId)).orderBy(asc(listeningSubtitleCues.sequence)),
  ]);
  return Response.json({ segments, cues });
}

export async function POST(request: Request) {
  const form = await request.formData(); const listeningId = Number(form.get("listeningId")); const action = String(form.get("action") || "audio");
  const db = await getDb(); const [parent] = await db.select().from(listeningSolutions).where(eq(listeningSolutions.id, listeningId)).limit(1);
  if (!parent) return Response.json({ error: "找不到聽解題項目" }, { status: 404 });
  if (action === "audio") {
    const file = form.get("file"); const durationSeconds = Math.max(0, Math.round(Number(form.get("durationSeconds")) || 0));
    if (!(file instanceof File) || !file.type.startsWith("audio/")) return Response.json({ error: "請選擇音檔" }, { status: 400 });
    if (file.size > 120 * 1024 * 1024) return Response.json({ error: "每段音檔請控制在 120MB 以下" }, { status: 400 });
    const existing = await db.select().from(listeningAudioSegments).where(eq(listeningAudioSegments.listeningId, listeningId)).orderBy(asc(listeningAudioSegments.sequence));
    const startOffsetSeconds = existing.reduce((sum, item) => sum + item.durationSeconds, 0); const sequence = existing.length;
    const { env } = await import("cloudflare:workers"); const key = `listening/${listeningId}/segments/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "-")}`;
    await env.BUCKET.put(key, file.stream(), { httpMetadata: { contentType: file.type } });
    const [segment] = await db.insert(listeningAudioSegments).values({ listeningId, storageKey: key, fileName: file.name, contentType: file.type, durationSeconds, startOffsetSeconds, sequence }).returning();
    return Response.json({ segment }, { status: 201 });
  }
  const file = form.get("file"); const segmentId = Number(form.get("segmentId")) || null;
  if (!(file instanceof File)) return Response.json({ error: "請選擇 SRT 字幕" }, { status: 400 });
  const cues = parseSrt(await file.text()); if (!cues.length) return Response.json({ error: "SRT 內找不到有效時間碼" }, { status: 400 });
  let offset = 0;
  if (segmentId) { const [segment] = await db.select().from(listeningAudioSegments).where(eq(listeningAudioSegments.id, segmentId)).limit(1); if (!segment || segment.listeningId !== listeningId) return Response.json({ error: "找不到指定音檔段落" }, { status: 404 }); offset = segment.startOffsetSeconds; await db.delete(listeningSubtitleCues).where(eq(listeningSubtitleCues.segmentId, segmentId)); }
  else await db.delete(listeningSubtitleCues).where(eq(listeningSubtitleCues.listeningId, listeningId));
  await db.insert(listeningSubtitleCues).values(cues.map((cue) => ({ ...cue, listeningId, segmentId, startSeconds: cue.startSeconds + offset, endSeconds: cue.endSeconds + offset })));
  return Response.json({ cues: cues.length, offset });
}

export async function PATCH(request: Request) {
  const body = await request.json() as { listeningId?: number; offsetSeconds?: number };
  if (!body.listeningId || !Number.isFinite(body.offsetSeconds)) return Response.json({ error: "缺少偏移秒數" }, { status: 400 });
  const db = await getDb(); const cues = await db.select().from(listeningSubtitleCues).where(eq(listeningSubtitleCues.listeningId, body.listeningId));
  await db.batch(cues.map((cue) => db.update(listeningSubtitleCues).set({ startSeconds: Math.max(0, cue.startSeconds + body.offsetSeconds!), endSeconds: Math.max(0, cue.endSeconds + body.offsetSeconds!) }).where(eq(listeningSubtitleCues.id, cue.id))));
  return Response.json({ updated: cues.length });
}

export async function DELETE(request: Request) {
  const id = Number(new URL(request.url).searchParams.get("id")); const db = await getDb(); const [segment] = await db.select().from(listeningAudioSegments).where(eq(listeningAudioSegments.id, id)).limit(1);
  if (!segment) return Response.json({ error: "找不到音檔段落" }, { status: 404 });
  const { env } = await import("cloudflare:workers"); await env.BUCKET.delete(segment.storageKey); await db.delete(listeningAudioSegments).where(eq(listeningAudioSegments.id, id));
  const remaining = await db.select().from(listeningAudioSegments).where(eq(listeningAudioSegments.listeningId, segment.listeningId)).orderBy(asc(listeningAudioSegments.sequence)); let offset = 0;
  for (let sequence = 0; sequence < remaining.length; sequence++) { await db.update(listeningAudioSegments).set({ sequence, startOffsetSeconds: offset }).where(eq(listeningAudioSegments.id, remaining[sequence].id)); offset += remaining[sequence].durationSeconds; }
  return Response.json({ ok: true });
}
