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

async function runProvider(provider: Provider, prompt: string, speaker: "teacher" | "scholar", stage: "question" | "answer" | "follow-up" | "reply") {
  const stageInstruction = stage === "question"
    ? "你是帶學生拆解司律二試的老師。請先用一句自然的話明確說出『這一回合要處理的單一法律爭點』，再提出一個具體、可直接回答的問題。爭點必須連結題目中的具體事實，例如身分、行為、因果關係或法律效果；不要只說請說明。不要先公布答案，不要一次問兩個問題。"
    : stage === "answer"
      ? "你是程度很高但仍要接受追問的法律學霸。請先明確回應老師剛才界定的那一個爭點，再說明規範與題目事實的涵攝，最後指出一個可能被老師挑戰的漏洞。不要換新爭點，也不要寫成完整申論擬答。"
      : stage === "follow-up"
        ? "你是嚴格的司律閱卷老師。請先指出學霸回答在原本那一個爭點上的具體缺口，再只追問一個最關鍵的漏洞或法律效果問題。不得偷偷換成另一個爭點，也不要直接給標準答案。"
        : "你是法律學霸。請正面承接原本的同一個爭點，回答老師的追問，修正剛才不足之處，補足法源、要件與個案涵攝，最後用一句自然的話說明考場應如何落筆。";
  const instructions = `你是台灣司律二試的法律對話模型，使用繁體中文與中華民國法律語境。${stageInstruction}\n只根據題目與提供的核對資料回答，不得虛構判決、法條內容或老師見解。請保持像老師與學生一來一往的自然對話，不要使用 Markdown 標題、星號、反引號或長篇條列。每一段都要讓讀者看得出目前討論的法律爭點，不要只給抽象定義。${stage === "question" || stage === "follow-up" ? "控制在 90 至 190 字。" : "控制在 170 至 330 字。"}`;
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

async function runCommentator(question: string, teacherQuestion: string, scholarAnswer: string, teacherFollowUp: string, scholarReply: string) {
  const key = await getOpenAIKey();
  if (!key) throw new Error("固定點評 Sol 需要 OPENAI_API_KEY");
  const instructions = "你是司律評的固定 AI 點評人，使用 gpt-5.6-sol。請像資深閱卷老師一樣，先明確說出本回合真正處理的法律爭點，再點評老師是否把爭點問清楚、學霸是否正面回答、哪個地方仍有漏洞，以及規範與個案涵攝是否完整。不得只偏好文筆；若雙方都有錯，要直接指出。最後給出 100 分制總評、三個最重要的修正，以及一段考場防呆筆記。使用繁體中文，不要使用 Markdown 符號，控制在 700 字內。";
  const input = `【題目】\n${question}\n\n【老師先問】\n${teacherQuestion}\n\n【學霸回答】\n${scholarAnswer}\n\n【老師追問】\n${teacherFollowUp}\n\n【學霸回應】\n${scholarReply}`;
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
    const body = await request.json() as { questionId?: number; teacherModel?: Provider; scholarModel?: Provider };
    const teacherModel: Provider = ["luna", "sonnet", "deepseek"].includes(String(body.teacherModel)) ? body.teacherModel as Provider : "luna";
    const scholarModel: Provider = ["luna", "sonnet", "deepseek"].includes(String(body.scholarModel)) ? body.scholarModel as Provider : "sonnet";
    const db = await getDb();
    const rows = await db.select().from(examQuestions).where(eq(examQuestions.status, "published")).orderBy(desc(examQuestions.id)).limit(80);
    const question = rows.find((row) => row.id === Number(body.questionId) && row.examType === "essay") ?? rows.find((row) => row.examType === "essay");
    if (!question) return Response.json({ error: "目前沒有已發布的二試申論題" }, { status: 404 });
    const context = questionContext(question);
    let teacherQuestion = null;
    let scholarAnswer = null;
    let teacherFollowUp = null;
    let scholarReply = null;
    let teacherError = "";
    let scholarError = "";
    try {
      teacherQuestion = await runProvider(teacherModel, context, "teacher", "question");
      scholarAnswer = await runProvider(scholarModel, `${context}\n\n【老師的問題】\n${teacherQuestion.text}`, "scholar", "answer");
      teacherFollowUp = await runProvider(teacherModel, `${context}\n\n【老師的問題】\n${teacherQuestion.text}\n\n【學霸的回答】\n${scholarAnswer.text}`, "teacher", "follow-up");
      scholarReply = await runProvider(scholarModel, `${context}\n\n【老師的問題】\n${teacherQuestion.text}\n\n【學霸的回答】\n${scholarAnswer.text}\n\n【老師的追問】\n${teacherFollowUp.text}`, "scholar", "reply");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!teacherQuestion || !teacherFollowUp) teacherError = message;
      else scholarError = message;
    }
    let commentator = null;
    let commentatorError = "";
    if (teacherQuestion?.text && scholarAnswer?.text && teacherFollowUp?.text && scholarReply?.text) {
      try { commentator = await runCommentator(context, teacherQuestion.text, scholarAnswer.text, teacherFollowUp.text, scholarReply.text); } catch (error) { commentatorError = error instanceof Error ? error.message : "固定點評暫時無法產生"; }
    } else {
      commentatorError = "老師與學霸的四句對話尚未完整，固定點評才能開始";
    }
    return Response.json({ question: { id: question.id, year: question.year, subject: question.subject, questionNumber: question.questionNumber, stem: question.stem, hasTeacherAnswer: Boolean(question.teacherAnswer?.trim()), answerSource: question.answerSource ?? "" }, models: { teacher: labels[teacherModel], scholar: labels[scholarModel], commentator: commentator?.model ?? "gpt-5.6-sol" }, teacherQuestion, scholarAnswer, teacherFollowUp, scholarReply, teacherError, scholarError, commentator, commentatorError });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "司律評暫時無法開始" }, { status: 500 });
  }
}
