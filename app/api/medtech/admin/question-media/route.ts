import { and, asc, eq } from "drizzle-orm";
import { getDb } from "../../../../../db";
import { examQuestions, listeningSolutions, listeningSubtitleCues } from "../../../../../db/schema";
import { decodeSubtitle, parseSrtCues } from "../../../../../lib/srt";
import { requireMedtechAdmin } from "../../../../../lib/member-auth";

const MAX_AUDIO_BYTES = 120 * 1024 * 1024;
const MAX_SRT_BYTES = 5 * 1024 * 1024;

function audioType(name: string, supplied: string) {
  if (supplied.startsWith("audio/")) return supplied;
  const extension = name.toLowerCase().split(".").pop();
  return extension === "m4a" ? "audio/mp4"
    : extension === "wav" ? "audio/wav"
      : extension === "ogg" ? "audio/ogg"
        : extension === "aac" ? "audio/aac"
          : extension === "webm" ? "audio/webm"
            : "audio/mpeg";
}

function isAudio(name: string, type: string) {
  return type.startsWith("audio/") || /\.(?:mp3|m4a|wav|ogg|aac|webm)$/iu.test(name);
}

function safeName(name: string) {
  return name.replace(/[^\p{L}\p{N}._-]+/gu, "-").slice(-160) || "audio.mp3";
}

function narrationText(question: {
  teacherCompleteExplanation?: string | null;
  completeExplanation?: string | null;
  aiCompleteExplanation?: string | null;
  simulatedCompleteExplanation?: string | null;
  voiceScript?: string | null;
  explanation?: string | null;
}) {
  return question.teacherCompleteExplanation
    || question.completeExplanation
    || question.aiCompleteExplanation
    || question.simulatedCompleteExplanation
    || question.voiceScript
    || question.explanation
    || "";
}

async function questionFor(id: number) {
  const db = await getDb();
  const [question] = await db.select().from(examQuestions)
    .where(and(eq(examQuestions.id, id), eq(examQuestions.examCategory, "medtech")))
    .limit(1);
  return { db, question };
}

export async function GET(request: Request) {
  const auth = await requireMedtechAdmin(request);
  if ("error" in auth) return auth.error;
  const questionId = Number(new URL(request.url).searchParams.get("questionId"));
  if (!Number.isInteger(questionId) || questionId < 1) return Response.json({ error: "缺少題目編號" }, { status: 400 });
  const { db, question } = await questionFor(questionId);
  if (!question) return Response.json({ error: "找不到醫檢題目" }, { status: 404 });
  const [solution] = await db.select().from(listeningSolutions).where(eq(listeningSolutions.questionId, questionId)).limit(1);
  const cues = solution
    ? await db.select().from(listeningSubtitleCues).where(eq(listeningSubtitleCues.listeningId, solution.id)).orderBy(asc(listeningSubtitleCues.sequence))
    : [];
  return Response.json({
    media: solution ? {
      solutionId: solution.id,
      audioFileName: solution.audioFileName,
      audioUrl: solution.audioStorageKey ? `/api/listening/audio?id=${solution.id}` : "",
      cues,
    } : null,
  });
}

export async function POST(request: Request) {
  const auth = await requireMedtechAdmin(request);
  if ("error" in auth) return auth.error;
  const form = await request.formData();
  const questionId = Number(form.get("questionId"));
  const action = String(form.get("action") || "audio");
  const file = form.get("file");
  if (!Number.isInteger(questionId) || questionId < 1) return Response.json({ error: "缺少題目編號" }, { status: 400 });
  if (!(file instanceof File)) return Response.json({ error: "請選擇要上傳的檔案" }, { status: 400 });
  const { db, question } = await questionFor(questionId);
  if (!question) return Response.json({ error: "找不到醫檢題目" }, { status: 404 });

  let [solution] = await db.select().from(listeningSolutions).where(eq(listeningSolutions.questionId, questionId)).limit(1);
  if (!solution) {
    [solution] = await db.insert(listeningSolutions).values({
      questionId,
      title: `${question.year || "未標示年份"} ${question.subject} 第${question.questionNumber || question.id}題`,
      year: question.year || "",
      subject: question.subject || "醫事檢驗",
      questionText: question.stem,
      narrationScript: narrationText(question),
      sourceUrl: `medtech:question:${question.id}`,
      status: "draft",
    }).returning();
  }

  if (action === "subtitle") {
    if (file.size > MAX_SRT_BYTES || !/\.srt$/iu.test(file.name)) return Response.json({ error: "請上傳 5MB 以下 SRT 字幕檔" }, { status: 400 });
    const parsed = parseSrtCues(decodeSubtitle(await file.arrayBuffer()));
    if (!parsed.length) return Response.json({ error: "SRT 內找不到有效時間碼，請確認格式為 00:00:00,000 --> 00:00:02,000" }, { status: 400 });
    await db.delete(listeningSubtitleCues).where(eq(listeningSubtitleCues.listeningId, solution.id));
    await db.insert(listeningSubtitleCues).values(parsed.map((cue, sequence) => ({ listeningId: solution.id, segmentId: null, startSeconds: cue.start, endSeconds: cue.end, text: cue.text, sequence })));
    return Response.json({ ok: true, cues: parsed.length, audioFileName: solution.audioFileName });
  }

  if (action !== "audio" || !isAudio(file.name, file.type)) return Response.json({ error: "請上傳 MP3、M4A、WAV、OGG、AAC 或 WebM 音檔" }, { status: 400 });
  if (file.size > MAX_AUDIO_BYTES) return Response.json({ error: "音檔不可超過 120MB" }, { status: 413 });
  const contentType = audioType(file.name, file.type);
  const key = `medtech-listening/${questionId}/${Date.now()}-${crypto.randomUUID()}-${safeName(file.name)}`;
  const { env } = await import("cloudflare:workers");
  await env.BUCKET.put(key, file.stream(), { httpMetadata: { contentType } });
  try {
    const [updated] = await db.update(listeningSolutions).set({
      audioStorageKey: key,
      audioFileName: file.name,
      questionText: question.stem,
      narrationScript: narrationText(question) || solution.narrationScript || "",
      updatedAt: new Date(),
    }).where(eq(listeningSolutions.id, solution.id)).returning({ id: listeningSolutions.id, audioFileName: listeningSolutions.audioFileName });
    if (solution.audioStorageKey) await env.BUCKET.delete(solution.audioStorageKey).catch(() => undefined);
    return Response.json({ ok: true, solutionId: updated.id, audioFileName: updated.audioFileName, audioUrl: `/api/listening/audio?id=${updated.id}` });
  } catch (error) {
    await env.BUCKET.delete(key).catch(() => undefined);
    throw error;
  }
}
