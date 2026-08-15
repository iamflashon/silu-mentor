import { and, asc, eq, inArray } from "drizzle-orm";
import { getDb } from "../../../../../db";
import { examQuestions, listeningSolutions } from "../../../../../db/schema";
import { requireMedtechAdmin } from "../../../../../lib/member-auth";

const MAX_FILES = 160;
const MAX_FILE_BYTES = 120 * 1024 * 1024;
const MAX_TOTAL_BYTES = 600 * 1024 * 1024;

function contentTypeFor(name: string, supplied: string) {
  if (supplied?.startsWith("audio/")) return supplied;
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

function plain(value: string) {
  return String(value ?? "")
    .replace(/<br\s*\/?>/giu, "\n")
    .replace(/<[^>]+>/gu, " ")
    .replace(/&nbsp;/giu, " ")
    .replace(/&amp;/giu, "&")
    .replace(/\s+/gu, " ")
    .trim();
}

export async function GET(request: Request) {
  const auth = await requireMedtechAdmin(request);
  if ("error" in auth) return auth.error;
  const db = await getDb();
  const questions = await db.select({
    id: examQuestions.id,
    year: examQuestions.year,
    subject: examQuestions.subject,
    questionNumber: examQuestions.questionNumber,
    stem: examQuestions.stem,
    explanation: examQuestions.explanation,
    correctAnswer: examQuestions.correctAnswer,
  }).from(examQuestions)
    .where(eq(examQuestions.examCategory, "medtech"))
    .orderBy(asc(examQuestions.subject), asc(examQuestions.year), asc(examQuestions.id))
    .limit(5000);
  const ids = questions.map((question) => question.id);
  const solutions = ids.length
    ? await db.select({
      id: listeningSolutions.id,
      questionId: listeningSolutions.questionId,
      audioFileName: listeningSolutions.audioFileName,
      status: listeningSolutions.status,
      updatedAt: listeningSolutions.updatedAt,
    }).from(listeningSolutions).where(inArray(listeningSolutions.questionId, ids))
    : [];
  const solutionByQuestion = new Map<number, (typeof solutions)[number]>();
  for (const solution of solutions) if (solution.questionId && !solutionByQuestion.has(solution.questionId)) solutionByQuestion.set(solution.questionId, solution);
  return Response.json({ items: questions.map((question) => ({ ...question, audio: solutionByQuestion.get(question.id) ?? null })) });
}

export async function POST(request: Request) {
  const auth = await requireMedtechAdmin(request);
  if ("error" in auth) return auth.error;
  const form = await request.formData();
  const files = form.getAll("audio").filter((value): value is File => value instanceof File);
  const questionIds = form.getAll("questionId").map((value) => Number(value));
  if (!files.length || files.length !== questionIds.length) return Response.json({ error: "音檔與題目配對資料不完整" }, { status: 400 });
  if (files.length > MAX_FILES) return Response.json({ error: `一次最多匯入 ${MAX_FILES} 段音檔` }, { status: 400 });
  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
  if (totalBytes > MAX_TOTAL_BYTES) return Response.json({ error: "本次音檔總容量不可超過 600MB" }, { status: 413 });
  for (const file of files) {
    if (!isAudio(file.name, file.type)) return Response.json({ error: `不支援的音檔格式：${file.name}` }, { status: 400 });
    if (file.size > MAX_FILE_BYTES) return Response.json({ error: `單段音檔不可超過 120MB：${file.name}` }, { status: 413 });
  }
  if (new Set(questionIds).size !== questionIds.length) return Response.json({ error: "同一道題目不可在同一批次重複匯入" }, { status: 400 });

  const db = await getDb();
  const questions = questionIds.length
    ? await db.select().from(examQuestions).where(and(eq(examQuestions.examCategory, "medtech"), inArray(examQuestions.id, questionIds)))
    : [];
  const questionById = new Map(questions.map((question) => [question.id, question]));
  const missing = questionIds.filter((id) => !questionById.has(id));
  if (missing.length) return Response.json({ error: `找不到醫檢題目：${missing.join(", ")}` }, { status: 404 });

  const { env } = await import("cloudflare:workers");
  if (!env.BUCKET) return Response.json({ error: "音檔儲存空間尚未就緒" }, { status: 503 });
  const results: Array<{ questionId: number; fileName: string; listeningId: number; replaced: boolean }> = [];
  for (let index = 0; index < files.length; index += 1) {
    const file = files[index];
    const question = questionById.get(questionIds[index]);
    if (!question) continue;
    const contentType = contentTypeFor(file.name, file.type);
    const key = `medtech-listening/${question.id}/${Date.now()}-${crypto.randomUUID()}-${safeName(file.name)}`;
    await env.BUCKET.put(key, file.stream(), { httpMetadata: { contentType } });
    const [old] = await db.select().from(listeningSolutions).where(eq(listeningSolutions.questionId, question.id)).limit(1);
    try {
      let row;
      if (old) {
        [row] = await db.update(listeningSolutions).set({ audioStorageKey: key, audioFileName: file.name, updatedAt: new Date() }).where(eq(listeningSolutions.id, old.id)).returning({ id: listeningSolutions.id });
        if (old.audioStorageKey) await env.BUCKET.delete(old.audioStorageKey).catch(() => undefined);
      } else {
        [row] = await db.insert(listeningSolutions).values({
          questionId: question.id,
          title: `${question.year || "未標示年份"} ${question.subject} 第${question.questionNumber || question.id}題`,
          year: question.year || "",
          subject: question.subject || "醫事檢驗",
          questionText: question.stem,
          narrationScript: plain(question.explanation),
          sourceUrl: `medtech:question:${question.id}`,
          audioStorageKey: key,
          audioFileName: file.name,
          status: "draft",
        }).returning({ id: listeningSolutions.id });
      }
      results.push({ questionId: question.id, fileName: file.name, listeningId: row.id, replaced: Boolean(old) });
    } catch (error) {
      await env.BUCKET.delete(key).catch(() => undefined);
      throw error;
    }
  }
  return Response.json({ imported: results.length, results }, { status: 201 });
}
