import { and, asc, eq, inArray, or } from "drizzle-orm";
import { unzipSync } from "fflate";
import { getDb } from "../../../../../db";
import { documents, examQuestions, listeningSolutions, listeningSubtitleCues } from "../../../../../db/schema";
import { requireMedtechAdmin } from "../../../../../lib/member-auth";
import { decodeSubtitle, parseSrtCues } from "../../../../../lib/srt";

const MAX_FILES = 160;
const MAX_FILE_BYTES = 120 * 1024 * 1024;
const MAX_SRT_BYTES = 5 * 1024 * 1024;
const MAX_TOTAL_BYTES = 600 * 1024 * 1024;
const MAX_ZIP_BYTES = 360 * 1024 * 1024;

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

function zipBaseName(name: string) {
  const normalized = name.replace(/\\/gu, "/").split("/").pop() ?? name;
  return normalized.replace(/\.[^.]+$/u, "").trim().toLocaleLowerCase();
}

function zipMatchInfo(name: string) {
  const base = zipBaseName(name);
  // A bare Q001 is the speaking-package sequence number, not the database qID.
  // Internal IDs are supported when q123 appears after an explicit prefix,
  // for example 001_q123_第1題.mp3.
  const qid = base.match(/[_-]q(?:uestion)?[_-]?(\d+)(?:[_-]|\.|$)/iu)?.[1] ?? "";
  const bareQNumber = base.match(/^q(?:uestion)?[_-]?(\d+)(?:[_-].*)?$/iu)?.[1] ?? "";
  const sourceOrder = name.match(/^(?:0*)(\d{1,4})(?:[_-])/u)?.[1] ?? bareQNumber;
  const questionNumber = name.match(/(?:第)\s*0*(\d{1,3})題?/iu)?.[1] ?? bareQNumber;
  return { base, qid, sourceOrder, questionNumber };
}

function zipAudioEntries(bytes: Uint8Array) {
  const entries = unzipSync(bytes);
  const groups = new Map<string, {
    base: string;
    qid: string;
    sourceOrder: string;
    questionNumber: string;
    audio?: { name: string; bytes: Uint8Array };
    subtitle?: { name: string; bytes: Uint8Array };
  }>();
  let ignored = 0;
  for (const [entryName, entryBytes] of Object.entries(entries)) {
    if (!entryBytes.length || /(?:^|\/)__macosx(?:\/|$)/iu.test(entryName) || /(?:^|\/)\.[^/]+$/u.test(entryName)) {
      ignored += 1;
      continue;
    }
    const lower = entryName.toLocaleLowerCase();
    const isAudioEntry = /\.(?:mp3|m4a|wav|ogg|aac|webm)$/iu.test(lower);
    const isSubtitleEntry = /\.srt$/iu.test(lower);
    if (!isAudioEntry && !isSubtitleEntry) {
      ignored += 1;
      continue;
    }
    const info = zipMatchInfo(entryName);
    const current = groups.get(info.base) ?? { ...info };
    if (isAudioEntry && !current.audio) current.audio = { name: entryName.replace(/\\/gu, "/").split("/").pop() ?? entryName, bytes: entryBytes };
    if (isSubtitleEntry && !current.subtitle) current.subtitle = { name: entryName.replace(/\\/gu, "/").split("/").pop() ?? entryName, bytes: entryBytes };
    groups.set(info.base, current);
  }
  return { groups: [...groups.values()], ignored };
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

function narrationText(question: {
  teacherCompleteExplanation?: string | null;
  completeExplanation?: string | null;
  aiCompleteExplanation?: string | null;
  simulatedCompleteExplanation?: string | null;
  voiceScript?: string | null;
  explanation?: string | null;
}) {
  return plain(
    question.teacherCompleteExplanation
      || question.completeExplanation
      || question.aiCompleteExplanation
      || question.simulatedCompleteExplanation
      || question.voiceScript
      || question.explanation
      || "",
  );
}

export async function GET(request: Request) {
  const auth = await requireMedtechAdmin(request);
  if ("error" in auth) return auth.error;
  const db = await getDb();
  const fields = {
    id: examQuestions.id,
    year: examQuestions.year,
    subject: examQuestions.subject,
    questionNumber: examQuestions.questionNumber,
    sourceOrder: examQuestions.sourceOrder,
    stem: examQuestions.stem,
    explanation: examQuestions.explanation,
    completeExplanation: examQuestions.completeExplanation,
    correctAnswer: examQuestions.correctAnswer,
  };
  const documentId = Number(new URL(request.url).searchParams.get("documentId"));
  let questions;
  if (Number.isInteger(documentId) && documentId > 0) {
    const [document] = await db.select({ storageKey: documents.storageKey, fileName: documents.fileName, subject: documents.subject })
      .from(documents).where(and(eq(documents.id, documentId), eq(documents.examCategory, "medtech"))).limit(1);
    const aliases = document ? [...new Set([`document:${documentId}`, document.storageKey, document.fileName])] : [];
    questions = document ? await db.select(fields).from(examQuestions)
      .where(and(eq(examQuestions.examCategory, "medtech"), or(inArray(examQuestions.sourceUrl, aliases), eq(examQuestions.subject, document.subject))))
      .orderBy(asc(examQuestions.sourceOrder), asc(examQuestions.id)).limit(1600) : [];
  } else {
    questions = await db.select(fields).from(examQuestions)
      .where(eq(examQuestions.examCategory, "medtech"))
      .orderBy(asc(examQuestions.subject), asc(examQuestions.year), asc(examQuestions.id))
      .limit(5000);
  }
  const ids = questions.map((question) => question.id);
  const solutions: Array<{
    id: number;
    questionId: number | null;
    audioFileName: string | null;
    status: string;
    updatedAt: Date;
  }> = [];
  for (let offset = 0; offset < ids.length; offset += 100) {
    const chunk = ids.slice(offset, offset + 100);
    const rows = await db.select({
      id: listeningSolutions.id,
      questionId: listeningSolutions.questionId,
      audioFileName: listeningSolutions.audioFileName,
      status: listeningSolutions.status,
      updatedAt: listeningSolutions.updatedAt,
    }).from(listeningSolutions).where(inArray(listeningSolutions.questionId, chunk));
    solutions.push(...rows);
  }
  const solutionByQuestion = new Map<number, (typeof solutions)[number]>();
  for (const solution of solutions) if (solution.questionId && !solutionByQuestion.has(solution.questionId)) solutionByQuestion.set(solution.questionId, solution);
  return Response.json({ items: questions.map((question) => ({ ...question, audio: solutionByQuestion.get(question.id) ?? null })) });
}

export async function POST(request: Request) {
  const auth = await requireMedtechAdmin(request);
  if ("error" in auth) return auth.error;
  const form = await request.formData();
  const zipFile = form.get("zip");
  if (zipFile instanceof File) {
    if (zipFile.size > MAX_ZIP_BYTES) return Response.json({ error: "語音包 ZIP 不可超過 360MB" }, { status: 413 });
    const documentId = Number(form.get("documentId"));
    if (!Number.isInteger(documentId) || documentId < 1) return Response.json({ error: "缺少文件編號，請從個別文件題庫上傳" }, { status: 400 });
    const db = await getDb();
    const [document] = await db.select().from(documents)
      .where(and(eq(documents.id, documentId), eq(documents.examCategory, "medtech"))).limit(1);
    if (!document) return Response.json({ error: "找不到指定的醫檢文件" }, { status: 404 });
    let parsedZip: ReturnType<typeof zipAudioEntries>;
    try {
      parsedZip = zipAudioEntries(new Uint8Array(await zipFile.arrayBuffer()));
    } catch {
      return Response.json({ error: "ZIP 無法讀取，請確認是未加密的標準 ZIP 檔" }, { status: 400 });
    }
    const aliases = [...new Set([`document:${document.id}`, document.storageKey, document.fileName])];
    let questions = await db.select().from(examQuestions)
      .where(and(eq(examQuestions.examCategory, "medtech"), inArray(examQuestions.sourceUrl, aliases)))
      .orderBy(asc(examQuestions.sourceOrder), asc(examQuestions.id)).limit(1600);
    if (!questions.length) {
      questions = await db.select().from(examQuestions)
        .where(and(eq(examQuestions.examCategory, "medtech"), eq(examQuestions.subject, document.subject)))
        .orderBy(asc(examQuestions.sourceOrder), asc(examQuestions.id)).limit(1600);
    }
    if (!questions.length) return Response.json({ error: "這份文件尚未有可配對的題目，請先完成拆題" }, { status: 409 });
    const { env } = await import("cloudflare:workers");
    if (!env.BUCKET) return Response.json({ error: "音檔儲存空間尚未就緒" }, { status: 503 });
    const questionById = new Map(questions.map((question) => [String(question.id), question]));
    const questionByOrder = new Map(questions.filter((question) => Number(question.sourceOrder) > 0).map((question) => [String(question.sourceOrder), question]));
    const questionByNumber = new Map<string, typeof questions[number][]>();
    for (const question of questions) questionByNumber.set(question.questionNumber.trim(), [...(questionByNumber.get(question.questionNumber.trim()) ?? []), question]);
    const matched = new Set<number>();
    const unmatched: Array<{ name: string; reason: string }> = [];
    const invalid: string[] = [];
    const results: Array<{ questionId: number; questionNumber: string; audioFileName?: string; subtitleFileName?: string; listeningId: number; cues?: number }> = [];
    const solutionByQuestion = new Map<number, typeof listeningSolutions.$inferSelect>();
    async function ensureSolution(questionId: number) {
      const existing = solutionByQuestion.get(questionId);
      if (existing) return existing;
      const question = questions.find((item) => item.id === questionId);
      if (!question) throw new Error("找不到題目");
      const [current] = await db.select().from(listeningSolutions).where(eq(listeningSolutions.questionId, questionId)).limit(1);
      if (current) {
        solutionByQuestion.set(questionId, current);
        return current;
      }
      const [created] = await db.insert(listeningSolutions).values({
        questionId: question.id,
        title: (question.year || "未標示年份") + " " + question.subject + " 第" + (question.questionNumber || question.id) + "題",
        year: question.year || "",
        subject: question.subject || "醫事檢驗",
        questionText: question.stem,
        narrationScript: narrationText(question),
        sourceUrl: "medtech:question:" + question.id,
        status: "draft",
      }).returning();
      solutionByQuestion.set(questionId, created);
      return created;
    }
    for (const group of parsedZip.groups) {
      const question = (group.qid && questionById.get(group.qid))
        ?? (group.sourceOrder && questionByOrder.get(String(Number(group.sourceOrder))))
        ?? (group.questionNumber && questionByNumber.get(String(Number(group.questionNumber)))?.length === 1 ? questionByNumber.get(String(Number(group.questionNumber)))?.[0] : undefined);
      if (!question) {
        unmatched.push({ name: group.audio?.name ?? group.subtitle?.name ?? group.base, reason: "找不到相同 q題目ID／原稿順序／唯一題號" });
        continue;
      }
      matched.add(question.id);
      let solution = await ensureSolution(question.id);
      let result = results.find((item) => item.questionId === question.id);
      if (!result) {
        result = { questionId: question.id, questionNumber: question.questionNumber, listeningId: solution.id };
        results.push(result);
      }
      if (group.audio) {
        if (group.audio.bytes.byteLength > MAX_FILE_BYTES) {
          invalid.push(`${group.audio.name}：單段音檔超過 120MB`);
        } else {
          const contentType = contentTypeFor(group.audio.name, "");
          const key = "medtech-listening/" + question.id + "/" + Date.now() + "-" + crypto.randomUUID() + "-" + safeName(group.audio.name);
          await env.BUCKET.put(key, group.audio.bytes, { httpMetadata: { contentType } });
          const [updated] = await db.update(listeningSolutions).set({ audioStorageKey: key, audioFileName: group.audio.name, questionText: question.stem, narrationScript: narrationText(question), updatedAt: new Date() }).where(eq(listeningSolutions.id, solution.id)).returning();
          if (solution.audioStorageKey) await env.BUCKET.delete(solution.audioStorageKey).catch(() => undefined);
          solution = updated;
          solutionByQuestion.set(question.id, updated);
          result.audioFileName = group.audio.name;
        }
      }
      if (group.subtitle) {
        if (group.subtitle.bytes.byteLength > MAX_SRT_BYTES) {
          invalid.push(`${group.subtitle.name}：SRT 超過 5MB`);
        } else {
          const parsed = parseSrtCues(decodeSubtitle(group.subtitle.bytes.slice().buffer));
          if (!parsed.length) {
            invalid.push(`${group.subtitle.name}：找不到有效字幕時間碼`);
          } else {
            await db.delete(listeningSubtitleCues).where(eq(listeningSubtitleCues.listeningId, solution.id));
            await db.insert(listeningSubtitleCues).values(parsed.map((cue, sequence) => ({ listeningId: solution.id, segmentId: null, startSeconds: cue.start, endSeconds: cue.end, text: cue.text, sequence })));
            result.subtitleFileName = group.subtitle.name;
            result.cues = parsed.length;
          }
        }
      }
    }
    return Response.json({ imported: results.length, matched: matched.size, audioPairs: results.filter((item) => item.audioFileName).length, subtitlePairs: results.filter((item) => item.subtitleFileName).length, ignored: parsedZip.ignored, unmatched, invalid, results }, { status: 201 });
  }
  const legacyAudioFiles = form.getAll("audio").filter((value): value is File => value instanceof File);
  const legacyQuestionIds = form.getAll("questionId").map((value) => Number(value));
  const audioFiles = legacyAudioFiles;
  const audioQuestionIds = form.getAll("audioQuestionId").length
    ? form.getAll("audioQuestionId").map((value) => Number(value))
    : legacyQuestionIds;
  const subtitleFiles = form.getAll("subtitle").filter((value): value is File => value instanceof File);
  const subtitleQuestionIds = form.getAll("subtitleQuestionId").map((value) => Number(value));
  if (!audioFiles.length && !subtitleFiles.length) return Response.json({ error: "請至少選擇一段音檔或一個 SRT 字幕檔" }, { status: 400 });
  if (audioFiles.length !== audioQuestionIds.length) return Response.json({ error: "音檔與題目配對資料不完整" }, { status: 400 });
  if (subtitleFiles.length !== subtitleQuestionIds.length) return Response.json({ error: "SRT 與題目配對資料不完整" }, { status: 400 });
  if (audioFiles.length > MAX_FILES || subtitleFiles.length > MAX_FILES) return Response.json({ error: "單批音檔或 SRT 最多 160 個" }, { status: 400 });
  const totalBytes = [...audioFiles, ...subtitleFiles].reduce((sum, file) => sum + file.size, 0);
  if (totalBytes > MAX_TOTAL_BYTES) return Response.json({ error: "本次音檔與 SRT 總容量不可超過 600MB" }, { status: 413 });
  for (const file of audioFiles) {
    if (!isAudio(file.name, file.type)) return Response.json({ error: "不支援的音檔格式：" + file.name }, { status: 400 });
    if (file.size > MAX_FILE_BYTES) return Response.json({ error: "單段音檔不可超過 120MB：" + file.name }, { status: 413 });
  }
  for (const file of subtitleFiles) {
    if (file.size > MAX_SRT_BYTES || !/\.srt$/iu.test(file.name)) return Response.json({ error: "請上傳 5MB 以下 SRT 字幕檔：" + file.name }, { status: 400 });
  }
  const allIds = [...new Set([...audioQuestionIds, ...subtitleQuestionIds])].filter((id) => Number.isInteger(id) && id > 0);
  if (![...audioQuestionIds, ...subtitleQuestionIds].every((id) => Number.isInteger(id) && id > 0)) {
    return Response.json({ error: "題目配對資料無效" }, { status: 400 });
  }
  const db = await getDb();
  const questions = allIds.length
    ? await db.select().from(examQuestions).where(and(eq(examQuestions.examCategory, "medtech"), inArray(examQuestions.id, allIds)))
    : [];
  const questionById = new Map(questions.map((question) => [question.id, question]));
  const missing = allIds.filter((id) => !questionById.has(id));
  if (missing.length) return Response.json({ error: "找不到醫檢題目：" + missing.join(", ") }, { status: 404 });
  const { env } = await import("cloudflare:workers");
  if (audioFiles.length && !env.BUCKET) return Response.json({ error: "音檔儲存空間尚未就緒" }, { status: 503 });
  const solutionByQuestion = new Map<number, typeof listeningSolutions.$inferSelect>();
  async function ensureSolution(questionId: number) {
    const existing = solutionByQuestion.get(questionId);
    if (existing) return existing;
    const question = questionById.get(questionId);
    if (!question) throw new Error("找不到題目");
    const [created] = await db.insert(listeningSolutions).values({
      questionId: question.id,
      title: (question.year || "未標示年份") + " " + question.subject + " 第" + (question.questionNumber || question.id) + "題",
      year: question.year || "",
      subject: question.subject || "醫事檢驗",
      questionText: question.stem,
      narrationScript: narrationText(question),
      sourceUrl: "medtech:question:" + question.id,
      status: "draft",
    }).returning();
    solutionByQuestion.set(questionId, created);
    return created;
  }
  const results: Array<{ questionId: number; audioFileName?: string; subtitleFileName?: string; listeningId: number; replaced?: boolean; cues?: number }> = [];
  for (let index = 0; index < audioFiles.length; index += 1) {
    const file = audioFiles[index];
    const question = questionById.get(audioQuestionIds[index]);
    if (!question || !env.BUCKET) continue;
    const contentType = contentTypeFor(file.name, file.type);
    const key = "medtech-listening/" + question.id + "/" + Date.now() + "-" + crypto.randomUUID() + "-" + safeName(file.name);
    await env.BUCKET.put(key, file.stream(), { httpMetadata: { contentType } });
    const oldSolution = solutionByQuestion.get(question.id)
      ?? (await db.select().from(listeningSolutions).where(eq(listeningSolutions.questionId, question.id)).limit(1))[0];
    try {
      const row = oldSolution
        ? (await db.update(listeningSolutions).set({ audioStorageKey: key, audioFileName: file.name, narrationScript: narrationText(question), updatedAt: new Date() }).where(eq(listeningSolutions.id, oldSolution.id)).returning())[0]
        : await ensureSolution(question.id);
      if (!oldSolution && row) {
        const [updated] = await db.update(listeningSolutions).set({ audioStorageKey: key, audioFileName: file.name, narrationScript: narrationText(question), updatedAt: new Date() }).where(eq(listeningSolutions.id, row.id)).returning();
        solutionByQuestion.set(question.id, updated);
      } else if (row) {
        solutionByQuestion.set(question.id, row);
      }
      if (oldSolution?.audioStorageKey) await env.BUCKET.delete(oldSolution.audioStorageKey).catch(() => undefined);
      const solution = solutionByQuestion.get(question.id);
      if (solution) results.push({ questionId: question.id, audioFileName: file.name, listeningId: solution.id, replaced: Boolean(oldSolution) });
    } catch (error) {
      await env.BUCKET.delete(key).catch(() => undefined);
      throw error;
    }
  }
  for (let index = 0; index < subtitleFiles.length; index += 1) {
    const file = subtitleFiles[index];
    const questionId = subtitleQuestionIds[index];
    const solution = await ensureSolution(questionId);
    const parsed = parseSrtCues(decodeSubtitle(await file.arrayBuffer()));
    if (!parsed.length) return Response.json({ error: "SRT 內找不到有效時間碼：" + file.name }, { status: 400 });
    await db.delete(listeningSubtitleCues).where(eq(listeningSubtitleCues.listeningId, solution.id));
    await db.insert(listeningSubtitleCues).values(parsed.map((cue, sequence) => ({
      listeningId: solution.id,
      segmentId: null,
      startSeconds: cue.start,
      endSeconds: cue.end,
      text: cue.text,
      sequence,
    })));
    const result = results.find((item) => item.questionId === questionId);
    if (result) {
      result.subtitleFileName = file.name;
      result.cues = parsed.length;
    } else {
      results.push({ questionId, subtitleFileName: file.name, listeningId: solution.id, cues: parsed.length });
    }
  }
  return Response.json({
    imported: results.length,
    importedAudio: audioFiles.length,
    importedSubtitles: subtitleFiles.length,
    results,
  }, { status: 201 });
}
