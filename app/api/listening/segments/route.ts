import { asc, eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { listeningAudioSegments, listeningSolutions, listeningSubtitleCues } from "../../../../db/schema";

function timeToSeconds(value: string) {
  const normalized = value.trim().replace(",", ".");
  const parts = normalized.split(":");
  if (parts.length === 3) {
    const [hours, minutes, seconds] = parts.map(Number);
    if (![hours, minutes, seconds].every(Number.isFinite)) return NaN;
    return Math.round(hours * 3600 + minutes * 60 + seconds);
  }
  if (parts.length === 2) {
    const [minutes, seconds] = parts.map(Number);
    if (![minutes, seconds].every(Number.isFinite)) return NaN;
    return Math.round(minutes * 60 + seconds);
  }
  return NaN;
}

function parseSrt(value: string) {
  const normalized = value.replace(/^\uFEFF/, "").replace(/\r/g, "").trim();
  const pattern = /(?:^|\n)\s*(?:\d+\s*\n)?\s*(\d{1,2}:\d{2}(?::\d{2})?[,.]\d{1,3})\s*-->\s*(\d{1,2}:\d{2}(?::\d{2})?[,.]\d{1,3})[^\n]*\n([\s\S]*?)(?=\n\s*(?:\d+\s*\n)?\s*\d{1,2}:\d{2}(?::\d{2})?[,.]\d{1,3}\s*-->|$)/g;
  const cues: Array<{ sequence: number; startSeconds: number; endSeconds: number; text: string }> = [];
  for (const [sequence, match] of [...normalized.matchAll(pattern)].entries()) {
    const startSeconds = timeToSeconds(match[1]);
    const endSeconds = timeToSeconds(match[2]);
    const text = match[3].replace(/<[^>]+>/g, "").split("\n").map((line) => line.trim()).filter(Boolean).join(" ").trim();
    if (text && Number.isFinite(startSeconds) && Number.isFinite(endSeconds) && endSeconds >= startSeconds)
      cues.push({ sequence, startSeconds, endSeconds, text });
  }
  return cues;
}

function findSegmentForCue(
  cue: { startSeconds: number; endSeconds: number },
  segments: Array<{ id: number; startOffsetSeconds: number; durationSeconds: number }>,
) {
  const midpoint = (cue.startSeconds + cue.endSeconds) / 2;
  return segments.find((segment) => {
    const end = segment.startOffsetSeconds + segment.durationSeconds;
    return midpoint >= segment.startOffsetSeconds && midpoint < end;
  }) ?? segments.find((segment) => {
    const end = segment.startOffsetSeconds + segment.durationSeconds;
    return cue.startSeconds < end && cue.endSeconds > segment.startOffsetSeconds;
  }) ?? null;
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
    const file = form.get("file"); const durationSeconds = Math.max(0, Math.round(Number(form.get("durationSeconds")) || 0)); const replaceId = Number(form.get("replaceId")) || null;
    if (!(file instanceof File) || !file.type.startsWith("audio/")) return Response.json({ error: "請選擇音檔" }, { status: 400 });
    if (file.size > 120 * 1024 * 1024) return Response.json({ error: "每段音檔請控制在 120MB 以下" }, { status: 400 });
    const existing = await db.select().from(listeningAudioSegments).where(eq(listeningAudioSegments.listeningId, listeningId)).orderBy(asc(listeningAudioSegments.sequence));
    const startOffsetSeconds = existing.reduce((sum, item) => sum + item.durationSeconds, 0); const sequence = existing.length;
    const { env } = await import("cloudflare:workers"); const key = `listening/${listeningId}/segments/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "-")}`;
    await env.BUCKET.put(key, file.stream(), { httpMetadata: { contentType: file.type } });
    if (replaceId) {
      const old = existing.find((item) => item.id === replaceId); if (!old) return Response.json({ error: "找不到要取代的段落" }, { status: 404 });
      await env.BUCKET.delete(old.storageKey); const delta = durationSeconds - old.durationSeconds;
      const [segment] = await db.update(listeningAudioSegments).set({ storageKey: key, fileName: file.name, contentType: file.type, durationSeconds }).where(eq(listeningAudioSegments.id, replaceId)).returning();
      if (delta) { for (const later of existing.filter((item) => item.sequence > old.sequence)) await db.update(listeningAudioSegments).set({ startOffsetSeconds: later.startOffsetSeconds + delta }).where(eq(listeningAudioSegments.id, later.id)); const cues = await db.select().from(listeningSubtitleCues).where(eq(listeningSubtitleCues.listeningId, listeningId)); for (const cue of cues.filter((item) => item.startSeconds >= old.startOffsetSeconds + old.durationSeconds)) await db.update(listeningSubtitleCues).set({ startSeconds: cue.startSeconds + delta, endSeconds: cue.endSeconds + delta }).where(eq(listeningSubtitleCues.id, cue.id)); }
      return Response.json({ segment, replaced: true });
    }
    const [segment] = await db.insert(listeningAudioSegments).values({ listeningId, storageKey: key, fileName: file.name, contentType: file.type, durationSeconds, startOffsetSeconds, sequence }).returning();
    return Response.json({ segment }, { status: 201 });
  }
  const file = form.get("file"); const segmentId = Number(form.get("segmentId")) || null;
  if (!(file instanceof File)) return Response.json({ error: "請選擇 SRT 字幕" }, { status: 400 });
  const cues = parseSrt(await file.text()); if (!cues.length) return Response.json({ error: "SRT 內找不到有效時間碼" }, { status: 400 });
  let offset = 0;
  if (segmentId) {
    const [segment] = await db.select().from(listeningAudioSegments).where(eq(listeningAudioSegments.id, segmentId)).limit(1);
    if (!segment || segment.listeningId !== listeningId) return Response.json({ error: "找不到指定音檔段落" }, { status: 404 });
    offset = segment.startOffsetSeconds;
    await db.delete(listeningSubtitleCues).where(eq(listeningSubtitleCues.segmentId, segmentId));
    await db.insert(listeningSubtitleCues).values(cues.map((cue) => ({ ...cue, listeningId, segmentId, startSeconds: cue.startSeconds + offset, endSeconds: cue.endSeconds + offset })));
    return Response.json({ cues: cues.length, offset, mappedSegments: 1, unmapped: 0 });
  }

  await db.delete(listeningSubtitleCues).where(eq(listeningSubtitleCues.listeningId, listeningId));
  const segments = await db.select({ id: listeningAudioSegments.id, startOffsetSeconds: listeningAudioSegments.startOffsetSeconds, durationSeconds: listeningAudioSegments.durationSeconds }).from(listeningAudioSegments).where(eq(listeningAudioSegments.listeningId, listeningId)).orderBy(asc(listeningAudioSegments.sequence));
  const hasUsableTimeline = segments.length > 0 && segments.some((segment) => segment.durationSeconds > 0);
  const mappedCues = cues.map((cue) => {
    const segment = hasUsableTimeline ? findSegmentForCue(cue, segments) : null;
    return { ...cue, listeningId, segmentId: segment?.id ?? null };
  });
  await db.insert(listeningSubtitleCues).values(mappedCues);
  const mappedSegments = new Set(mappedCues.map((cue) => cue.segmentId).filter((id): id is number => id !== null));
  return Response.json({ cues: cues.length, offset: 0, mappedSegments: mappedSegments.size, unmapped: mappedCues.filter((cue) => cue.segmentId === null).length, autoMapped: hasUsableTimeline });
}

export async function PATCH(request: Request) {
  const body = await request.json() as { listeningId?: number; offsetSeconds?: number; cueId?: number; text?: string; startSeconds?: number; endSeconds?: number };
  const db = await getDb();
  if (body.cueId) { const [cue] = await db.update(listeningSubtitleCues).set({ text: String(body.text ?? "").trim(), startSeconds: Math.max(0, Number(body.startSeconds) || 0), endSeconds: Math.max(0, Number(body.endSeconds) || 0) }).where(eq(listeningSubtitleCues.id, body.cueId)).returning(); return Response.json({ cue }); }
  if (!body.listeningId || !Number.isFinite(body.offsetSeconds)) return Response.json({ error: "缺少偏移秒數" }, { status: 400 });
  const cues = await db.select().from(listeningSubtitleCues).where(eq(listeningSubtitleCues.listeningId, body.listeningId));
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
