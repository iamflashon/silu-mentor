import { and, eq, sql } from "drizzle-orm";
import { documents, examQuestions, medtechAiExplanationCache, usageLogs } from "../../../../../db/schema";
import { requireMedtechAdmin } from "../../../../../lib/member-auth";
import { getOpenAIKey, getOpenAIModel, openAIJson } from "../../../../../lib/openai";

const levels = ["入門", "進階", "考前衝刺"] as const;
const answers = ["A", "B", "C", "D"] as const;

function outputText(payload: Record<string, unknown>) {
  if (typeof payload.output_text === "string") return payload.output_text.trim();
  for (const item of Array.isArray(payload.output) ? payload.output : []) {
    const content = item && typeof item === "object" && Array.isArray((item as { content?: unknown[] }).content)
      ? (item as { content: unknown[] }).content : [];
    for (const part of content) if (part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string") return (part as { text: string }).text.trim();
  }
  return "";
}

function plain(value: string) {
  return String(value ?? "").replace(/<br\s*\/?>/giu, "\n").replace(/<[^>]+>/gu, " ").replace(/\s+/gu, " ").trim();
}

const publishedMedtech = and(eq(examQuestions.examCategory, "medtech"), eq(examQuestions.status, "published"));
const hasUsableAnswer = sql`upper(trim(coalesce(nullif(${examQuestions.teacherAnswer}, ''), nullif(${examQuestions.correctAnswer}, ''), nullif(${examQuestions.simulatedAnswer}, ''), ''))) in ('A','B','C','D')`;
const hasCompleteOptions = sql`json_valid(${examQuestions.optionsJson}) and length(trim(coalesce(json_extract(${examQuestions.optionsJson}, '$.A'), ''))) > 0 and length(trim(coalesce(json_extract(${examQuestions.optionsJson}, '$.B'), ''))) > 0 and length(trim(coalesce(json_extract(${examQuestions.optionsJson}, '$.C'), ''))) > 0 and length(trim(coalesce(json_extract(${examQuestions.optionsJson}, '$.D'), ''))) > 0`;
const eligibleMedtech = and(publishedMedtech, hasUsableAnswer, hasCompleteOptions);
const hasHint = sql`exists (select 1 from medtech_ai_explanation_cache c where c.question_id = ${examQuestions.id} and c.cache_key like 'medtech:hint:%')`;
const hasCompare = sql`exists (select 1 from medtech_ai_explanation_cache c where c.question_id = ${examQuestions.id} and c.cache_key like 'medtech:compare:%')`;

export async function GET(request: Request) {
  const auth = await requireMedtechAdmin(request);
  if ("error" in auth) return auth.error;
  const url = new URL(request.url);
  const requestedDocumentId = Number(url.searchParams.get("documentId") || 0);
  const documentRows = await auth.db.select({
    id: documents.id, fileName: documents.fileName, bookTitle: documents.bookTitle,
    storageKey: documents.storageKey, subject: documents.subject,
    questionCount: documents.questionCount, processingStage: documents.processingStage,
  }).from(documents).where(eq(documents.examCategory, "medtech")).orderBy(documents.id);
  const questionRows = await auth.db.select({
    id: examQuestions.id, year: examQuestions.year, subject: examQuestions.subject,
    questionNumber: examQuestions.questionNumber, stem: examQuestions.stem,
    sourceUrl: examQuestions.sourceUrl, status: examQuestions.status,
    usable: sql<number>`case when ${hasUsableAnswer} and ${hasCompleteOptions} then 1 else 0 end`,
    ready: sql<number>`case when ${hasUsableAnswer} and ${hasCompleteOptions} and ${hasHint} and ${hasCompare} then 1 else 0 end`,
  }).from(examQuestions).where(eq(examQuestions.examCategory, "medtech")).orderBy(examQuestions.id);

  const ownerByQuestion = new Map<number, number>();
  for (const question of questionRows) {
    const source = String(question.sourceUrl || "");
    const owner = documentRows.find((document) => source === `document:${document.id}` || source === document.storageKey || source === document.fileName);
    if (owner) ownerByQuestion.set(question.id, owner.id);
  }
  const documentStatus = documentRows.map((document) => {
    const questions = questionRows.filter((question) => ownerByQuestion.get(question.id) === document.id);
    const publishedQuestions = questions.filter((question) => question.status === "published");
    const eligibleQuestions = publishedQuestions.filter((question) => Number(question.usable) === 1);
    const readyQuestions = eligibleQuestions.filter((question) => Number(question.ready) === 1);
    const draft = questions.filter((question) => question.status !== "published").length;
    const state = !questions.length ? "尚未拆題" : draft && !publishedQuestions.length ? "待發布" : readyQuestions.length < eligibleQuestions.length ? "已發布待引導" : eligibleQuestions.length ? "引導完成" : "缺答案或選項";
    return {
      id: document.id, name: document.bookTitle || document.fileName, fileName: document.fileName,
      subject: document.subject, processingStage: document.processingStage,
      total: questions.length, draft, published: publishedQuestions.length,
      eligible: eligibleQuestions.length, ready: readyQuestions.length,
      unavailable: Math.max(0, publishedQuestions.length - eligibleQuestions.length), state,
    };
  });
  const publishedQuestions = questionRows.filter((question) => question.status === "published");
  const eligibleQuestions = publishedQuestions.filter((question) => Number(question.usable) === 1);
  const readyQuestions = eligibleQuestions.filter((question) => Number(question.ready) === 1);
  const pending = eligibleQuestions.filter((question) => Number(question.ready) !== 1 && (!requestedDocumentId || ownerByQuestion.get(question.id) === requestedDocumentId)).slice(0, 50).map(({ usable: _usable, ready: _ready, sourceUrl: _sourceUrl, status: _status, ...question }) => question);
  return Response.json({
    published: publishedQuestions.length, eligible: eligibleQuestions.length,
    unavailable: Math.max(0, publishedQuestions.length - eligibleQuestions.length),
    ready: readyQuestions.length, pending, documents: documentStatus,
  });
}

export async function POST(request: Request) {
  const auth = await requireMedtechAdmin(request);
  if ("error" in auth) return auth.error;
  const body = await request.json() as { id?: number; force?: boolean };
  const id = Number(body.id);
  if (!Number.isInteger(id) || id < 1) return Response.json({ error: "缺少題目編號" }, { status: 400 });
  const [question] = await auth.db.select().from(examQuestions).where(and(eq(examQuestions.id, id), eq(examQuestions.examCategory, "medtech"))).limit(1);
  if (!question) return Response.json({ error: "找不到醫檢題目" }, { status: 404 });
  const correctAnswer = String(question.teacherAnswer || question.correctAnswer || question.simulatedAnswer || "").trim().toUpperCase();
  if (!answers.includes(correctAnswer as typeof answers[number])) return Response.json({ error: "本題尚未設定 A～D 正確答案" }, { status: 422 });
  let options: Record<string, string> = {};
  try { options = JSON.parse(question.optionsJson || "{}") as Record<string, string>; } catch { /* reported below */ }
  if (!answers.every((key) => plain(options[key] || ""))) return Response.json({ error: "本題 A～D 選項尚未完整" }, { status: 422 });
  const [existing] = await auth.db.select({ count: sql<number>`count(*)` }).from(medtechAiExplanationCache).where(eq(medtechAiExplanationCache.questionId, id));
  if (Number(existing?.count ?? 0) >= 15 && !body.force) return Response.json({ skipped: true, id });

  if (!await getOpenAIKey()) return Response.json({ error: "此站尚未設定 OPENAI_API_KEY，請先到 Sites 設定新增秘密環境變數後再產生。" }, { status: 503 });
  const model = await getOpenAIModel("gpt-5.6-luna");
  let payload: Record<string, unknown>;
  try {
    payload = await openAIJson("/responses", {
      method: "POST",
      body: JSON.stringify({
        model,
        instructions: "你是台灣醫事檢驗師國考教材編輯。請為題目預先整理兩份可存入資料庫、供學生直接讀取的內容。hint 是學生作答前的單一判斷線索，40～80 字，不得公布答案或暗示選項字母。comparison 是學生作答後看到的四選項比較，先說正確答案，再用 A、B、C、D 各一行簡潔說明正誤關鍵，共 120～220 字。只能依題目、既有答案與解析，不得捏造。使用繁體中文純文字，不使用 Markdown 星號、表格或標題符號。",
        input: `科目：${question.subject}\n年份：${question.year}\n題號：${question.questionNumber}\n題幹：${plain(question.stem)}\n選項：${JSON.stringify(Object.fromEntries(answers.map((key) => [key, plain(options[key])])))}\n正確答案：${correctAnswer}\n原稿解析：${plain(question.explanation) || "無"}\n完整解析：${plain(question.teacherCompleteExplanation || question.completeExplanation || question.aiCompleteExplanation || question.simulatedCompleteExplanation) || "無"}`,
        text: { format: { type: "json_schema", name: "medtech_guided_content", strict: true, schema: { type: "object", additionalProperties: false, properties: { hint: { type: "string" }, comparison: { type: "string" } }, required: ["hint", "comparison"] } } },
        max_output_tokens: 700,
      }),
    }) as Record<string, unknown>;
  } catch (error) {
    console.error("medtech.guided-content.generate.failed", error);
    return Response.json({ error: error instanceof Error ? error.message : "AI 產生失敗，請稍後再試。" }, { status: 502 });
  }
  let generated: { hint?: string; comparison?: string } = {};
  try { generated = JSON.parse(outputText(payload)) as typeof generated; } catch { /* handled below */ }
  const hint = String(generated.hint || "").trim();
  const comparison = String(generated.comparison || "").trim();
  if (hint.length < 20 || comparison.length < 60) return Response.json({ error: "AI 未產生完整的提示與選項比較" }, { status: 502 });

  const rows = [
    ...levels.map((level) => ({ cacheKey: `medtech:hint:${id}:${level}`, questionId: id, answer: "", level, reply: hint })),
    ...levels.flatMap((level) => answers.map((answer) => ({ cacheKey: `medtech:compare:${id}:${answer}:${level}`, questionId: id, answer, level, reply: comparison }))),
  ];
  for (const row of rows) await auth.db.insert(medtechAiExplanationCache).values(row).onConflictDoUpdate({ target: medtechAiExplanationCache.cacheKey, set: { reply: row.reply, answer: row.answer, level: row.level, lastUsedAt: new Date() } });
  const usage = payload.usage && typeof payload.usage === "object" ? payload.usage as { input_tokens?: number; output_tokens?: number; input_tokens_details?: { cached_tokens?: number } } : {};
  await auth.db.insert(usageLogs).values({ model, source: `醫檢引導內容預先產生｜題目 ${id}`, inputTokens: usage.input_tokens ?? 0, cachedTokens: usage.input_tokens_details?.cached_tokens ?? 0, outputTokens: usage.output_tokens ?? 0, fileSearchCalls: 0, estimatedCostUsdMicros: 0 }).catch(() => undefined);
  return Response.json({ generated: true, id, stored: rows.length, hint, comparison });
}
