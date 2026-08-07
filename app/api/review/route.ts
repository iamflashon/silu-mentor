import { desc, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { examQuestions } from "../../../db/schema";
import { getAnthropicChatModel, getAnthropicKey, getDeepSeekKey, getDeepSeekModel, getOpenAIKey, getOpenAIModel, getTeachingJudgeOpenAIModel } from "../../../lib/openai";

type Provider = "luna" | "sonnet" | "deepseek";

const labels: Record<Provider, string> = {
  luna: "Luna",
  sonnet: "Claude Sonnet",
  deepseek: "DeepSeek V4-Pro",
};

function readOpenAIText(payload: unknown) {
  if (!payload || typeof payload !== "object") return "";
  const output = (payload as { output?: unknown[] }).output;
  if (!Array.isArray(output)) return "";
  return output.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const content = (item as { content?: unknown[] }).content;
    if (!Array.isArray(content)) return [];
    return content.map((part) => part && typeof part === "object" ? String((part as { text?: unknown }).text ?? "") : "");
  }).join("").trim();
}

function readAnthropicText(payload: unknown) {
  if (!payload || typeof payload !== "object") return "";
  const content = (payload as { content?: unknown[] }).content;
  if (!Array.isArray(content)) return "";
  return content.map((part) => part && typeof part === "object" ? String((part as { text?: unknown }).text ?? "") : "").join("").trim();
}

function readDeepSeekText(payload: unknown) {
  if (!payload || typeof payload !== "object") return "";
  const choices = (payload as { choices?: Array<{ message?: { content?: string } }> }).choices;
  return choices?.[0]?.message?.content?.trim() ?? "";
}

function jsonError(payload: unknown, fallback: string) {
  if (!payload || typeof payload !== "object") return fallback;
  const error = (payload as { error?: unknown }).error;
  if (error && typeof error === "object" && typeof (error as { message?: unknown }).message === "string") return String((error as { message: string }).message).slice(0, 260);
  return fallback;
}

function questionContext(question: typeof examQuestions.$inferSelect) {
  const rubric = question.rubricJson?.trim() ? `\n評分重點：${question.rubricJson.slice(0, 5000)}` : "";
  const teacher = question.teacherAnswer?.trim() ? `\n老師參考擬答（只作為核對依據，不可冒充官方答案）：\n${question.teacherAnswer.slice(0, 10000)}` : "";
  const notes = question.teacherNotes?.trim() ? `\n老師補充：${question.teacherNotes.slice(0, 3000)}` : "";
  return `年度：${question.year}\n科目：${question.subject}\n題號：${question.questionNumber}\n題目：\n${question.stem.slice(0, 18000)}${teacher}${notes}${rubric}`;
}

async function runOpenAI(apiKey: string, model: string, instructions: string, input: string) {
  const startedAt = Date.now();
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({ model, instructions, input, max_output_tokens: 2200 }),
  });
  const payload = await response.json() as unknown;
  if (!response.ok) throw new Error(`${jsonError(payload, "OpenAI 回覆失敗")}（HTTP ${response.status}）`);
  const text = readOpenAIText(payload);
  if (!text) throw new Error("OpenAI 未產生可顯示內容");
  const usage = payload && typeof payload === "object" ? (payload as { usage?: { input_tokens?: number; output_tokens?: number; input_tokens_details?: { cached_tokens?: number } } }).usage : undefined;
  return { model, text, durationMs: Date.now() - startedAt, inputTokens: Number(usage?.input_tokens ?? 0), outputTokens: Number(usage?.output_tokens ?? 0), cachedTokens: Number(usage?.input_tokens_details?.cached_tokens ?? 0) };
}

async function runAnthropic(apiKey: string, model: string, instructions: string, input: string) {
  const startedAt = Date.now();
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model, system: instructions, messages: [{ role: "user", content: input }], max_tokens: 2200 }),
  });
  const payload = await response.json() as unknown;
  if (!response.ok) throw new Error(`${jsonError(payload, "Claude 回覆失敗")}（HTTP ${response.status}）`);
  const text = readAnthropicText(payload);
  if (!text) throw new Error("Claude 未產生可顯示內容");
  const usage = payload && typeof payload === "object" ? (payload as { usage?: { input_tokens?: number; output_tokens?: number } }).usage : undefined;
  return { model, text, durationMs: Date.now() - startedAt, inputTokens: Number(usage?.input_tokens ?? 0), outputTokens: Number(usage?.output_tokens ?? 0), cachedTokens: 0 };
}

async function runDeepSeek(apiKey: string, model: string, instructions: string, input: string) {
  const startedAt = Date.now();
  const response = await fetch("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({ model, messages: [{ role: "system", content: instructions }, { role: "user", content: input }], max_tokens: 2200 }),
  });
  const payload = await response.json() as unknown;
  if (!response.ok) throw new Error(`${jsonError(payload, "DeepSeek 回覆失敗")}（HTTP ${response.status}）`);
  const text = readDeepSeekText(payload);
  if (!text) throw new Error("DeepSeek 未產生可顯示內容");
  const usage = payload && typeof payload === "object" ? (payload as { usage?: { prompt_tokens?: number; completion_tokens?: number } }).usage : undefined;
  return { model, text, durationMs: Date.now() - startedAt, inputTokens: Number(usage?.prompt_tokens ?? 0), outputTokens: Number(usage?.completion_tokens ?? 0), cachedTokens: 0 };
}

async function runProvider(provider: Provider, prompt: string, role: "positive" | "negative") {
  const roleInstruction = role === "positive"
    ? "你是申論題攻防中的正方。站在檢察官、原告或主張成立的一方，先做行為定位，再提出最有力的爭點、規範與涵攝。你可以承認爭議，但要清楚說明為何本方結論較可採。"
    : "你是申論題攻防中的反方。站在辯護人、被告或主張不成立的一方，找出正方論證的漏洞，提出反駁與替代涵攝。不要只說正方錯，要精準指出事實、要件或法律效果的斷點。";
  const instructions = `你是台灣司律二試的法律攻防模型。使用繁體中文與中華民國法律語境。${roleInstruction}\n只根據題目與提供的核對資料回答，不得虛構判決、法條內容或老師見解。這是觀戰用的開場主張，控制在 500 至 800 字，最後列出本方最想逼對方回答的一個問題。`;
  if (provider === "luna") {
    const key = await getOpenAIKey();
    if (!key) throw new Error("OPENAI_API_KEY 尚未設定");
    return runOpenAI(key, await getOpenAIModel("gpt-5.6-luna"), instructions, prompt);
  }
  if (provider === "sonnet") {
    const key = await getAnthropicKey();
    if (!key) throw new Error("ANTHROPIC_API_KEY 尚未設定");
    return runAnthropic(key, await getAnthropicChatModel("claude-sonnet-5"), instructions, prompt);
  }
  const key = await getDeepSeekKey();
  if (!key) throw new Error("DEEPSEEK_API_KEY 尚未設定");
  return runDeepSeek(key, await getDeepSeekModel("deepseek-v4-pro"), instructions, prompt);
}

async function runCommentator(question: string, positive: string, negative: string) {
  const key = await getOpenAIKey();
  if (!key) throw new Error("固定點評 Sol 需要 OPENAI_API_KEY");
  const instructions = "你是司律評的固定 AI 點評人，使用 gpt-5.6-sol。請像資深閱卷老師一樣，比較正反方的爭點辨識、規範正確性、個案涵攝、攻防完整度與考場可用性。不得只偏好文筆；若雙方都有錯，要直接指出。最後給出 100 分制總評、三個最重要的修正，以及一段考場防呆筆記。使用繁體中文，控制在 700 字內。";
  const input = `【題目】\n${question}\n\n【正方】\n${positive}\n\n【反方】\n${negative}`;
  return runOpenAI(key, await getTeachingJudgeOpenAIModel("gpt-5.6-sol"), instructions, input);
}

export async function GET(request: Request) {
  try {
    const db = await getDb();
    const selectedId = Number(new URL(request.url).searchParams.get("id"));
    const rows = await db.select().from(examQuestions).where(eq(examQuestions.status, "published")).orderBy(desc(examQuestions.id)).limit(80);
    const essays = rows.filter((row) => row.examType === "essay").map((row) => ({ id: row.id, year: row.year, subject: row.subject, questionNumber: row.questionNumber, stem: row.stem, hasTeacherAnswer: Boolean(row.teacherAnswer?.trim()), answerSource: row.answerSource ?? "" }));
    const question = essays.find((row) => row.id === selectedId) ?? essays[0] ?? null;
    return Response.json({ questions: essays, question });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "申論題資料暫時無法讀取" }, { status: 503 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { questionId?: number; positiveModel?: Provider; negativeModel?: Provider };
    const positiveModel: Provider = ["luna", "sonnet", "deepseek"].includes(String(body.positiveModel)) ? body.positiveModel as Provider : "luna";
    const negativeModel: Provider = ["luna", "sonnet", "deepseek"].includes(String(body.negativeModel)) ? body.negativeModel as Provider : "sonnet";
    const db = await getDb();
    const rows = await db.select().from(examQuestions).where(eq(examQuestions.status, "published")).orderBy(desc(examQuestions.id)).limit(80);
    const question = rows.find((row) => row.id === Number(body.questionId) && row.examType === "essay") ?? rows.find((row) => row.examType === "essay");
    if (!question) return Response.json({ error: "目前沒有已發布的二試申論題" }, { status: 404 });
    const context = questionContext(question);
    const [positiveRun, negativeRun] = await Promise.allSettled([runProvider(positiveModel, context, "positive"), runProvider(negativeModel, context, "negative")]);
    const positive = positiveRun.status === "fulfilled" ? positiveRun.value : null;
    const negative = negativeRun.status === "fulfilled" ? negativeRun.value : null;
    const positiveError = positiveRun.status === "rejected" ? String(positiveRun.reason instanceof Error ? positiveRun.reason.message : positiveRun.reason) : null;
    const negativeError = negativeRun.status === "rejected" ? String(negativeRun.reason instanceof Error ? negativeRun.reason.message : negativeRun.reason) : null;
    let commentator = null;
    let commentatorError = "";
    if (positive?.text && negative?.text) {
      try { commentator = await runCommentator(context, positive.text, negative.text); } catch (error) { commentatorError = error instanceof Error ? error.message : "固定點評暫時無法產生"; }
    } else {
      commentatorError = "正反方至少需要各自產生一份回答，固定點評才能開始";
    }
    return Response.json({ question: { id: question.id, year: question.year, subject: question.subject, questionNumber: question.questionNumber, stem: question.stem, hasTeacherAnswer: Boolean(question.teacherAnswer?.trim()), answerSource: question.answerSource ?? "" }, models: { positive: labels[positiveModel], negative: labels[negativeModel], commentator: commentator?.model ?? "gpt-5.6-sol" }, positive, negative, positiveError, negativeError, commentator, commentatorError });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "司律評暫時無法開始" }, { status: 500 });
  }
}
