import { getAnthropicChatModel, getAnthropicKey, getOpenAIKey, getOpenAIModel, getTeachingJudgeOpenAIModel } from "../../../../lib/openai";
import { estimateCostUsdMicros } from "../../../../lib/usage";
import { getDb } from "../../../../db";
import { usageLogs } from "../../../../db/schema";

type AnswerProvider = "luna" | "sol";
type Challenger = "terra" | "sonnet";

function openAiText(payload: unknown) {
  const direct = payload && typeof payload === "object" ? (payload as { output_text?: unknown }).output_text : "";
  if (typeof direct === "string" && direct.trim()) return direct.trim();
  const output = payload && typeof payload === "object" ? (payload as { output?: unknown[] }).output : [];
  return Array.isArray(output) ? output.flatMap((item) => item && typeof item === "object" && Array.isArray((item as { content?: unknown[] }).content) ? (item as { content: Array<{ text?: string }> }).content.map((part) => part.text ?? "") : []).join("").trim() : "";
}

function anthropicText(payload: unknown) {
  const content = payload && typeof payload === "object" ? (payload as { content?: unknown[] }).content : [];
  return Array.isArray(content) ? content.map((part) => part && typeof part === "object" ? String((part as { text?: unknown }).text ?? "") : "").join("").trim() : "";
}

function usageFrom(payload: unknown) {
  const usage = payload && typeof payload === "object" ? (payload as { usage?: Record<string, unknown> }).usage : undefined;
  const details = usage?.input_tokens_details && typeof usage.input_tokens_details === "object" ? usage.input_tokens_details as Record<string, unknown> : undefined;
  return { inputTokens: Number(usage?.input_tokens ?? usage?.prompt_tokens ?? 0), cachedTokens: Number(details?.cached_tokens ?? 0), outputTokens: Number(usage?.output_tokens ?? usage?.completion_tokens ?? 0) };
}

async function runOpenAI(model: string, instructions: string, input: string) {
  const key = await getOpenAIKey();
  if (!key) throw new Error("OpenAI API 尚未設定");
  const started = Date.now();
  const response = await fetch("https://api.openai.com/v1/responses", { method: "POST", headers: { authorization: `Bearer ${key}`, "content-type": "application/json" }, body: JSON.stringify({ model, instructions, input, max_output_tokens: 2600 }) });
  const payload = await response.json() as unknown;
  if (!response.ok) throw new Error("模型暫時無法完成本次檢核");
  const text = openAiText(payload);
  if (!text) throw new Error("模型沒有產生可顯示的內容");
  return { model, text, durationMs: Date.now() - started, ...usageFrom(payload) };
}

async function runSonnet(instructions: string, input: string) {
  const key = await getAnthropicKey();
  if (!key) throw new Error("Claude Sonnet API 尚未設定");
  const model = await getAnthropicChatModel("claude-sonnet-5");
  const started = Date.now();
  const response = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" }, body: JSON.stringify({ model, system: instructions, messages: [{ role: "user", content: input }], max_tokens: 2600 }) });
  const payload = await response.json() as unknown;
  if (!response.ok) throw new Error("Claude Sonnet 暫時無法完成本次檢核");
  const text = anthropicText(payload);
  if (!text) throw new Error("Claude Sonnet 沒有產生可顯示的內容");
  return { model, text, durationMs: Date.now() - started, ...usageFrom(payload) };
}

async function saveUsage(model: string, result: { inputTokens: number; cachedTokens: number; outputTokens: number }, source: string) {
  const estimatedCostUsdMicros = estimateCostUsdMicros(model, result);
  const db = await getDb();
  await db.insert(usageLogs).values({ model, source, inputTokens: result.inputTokens, cachedTokens: result.cachedTokens, outputTokens: result.outputTokens, fileSearchCalls: 0, estimatedCostUsdMicros });
  return estimatedCostUsdMicros / 1_000_000;
}

const clean = (value: unknown, max: number) => String(value ?? "").trim().slice(0, max);

export async function POST(request: Request) {
  try {
    const body = await request.json() as Record<string, unknown>;
    const action = clean(body.action, 30);
    const question = clean(body.question, 12000);
    const teacherAnswer = clean(body.teacherAnswer, 16000);
    const studentAnswer = clean(body.studentAnswer, 10000);
    if (question.length < 20 || teacherAnswer.length < 40) return Response.json({ error: "本題尚未取得可核對的完整老師解析／擬答，暫不開放模型評選與質疑。" }, { status: 409 });

    const shared = `你處理的是台灣司律考試題。老師解析／擬答是本次正確性評選的唯一主要校準依據。不得補造題目事實；不得以老師未採取的其他學說改判老師見解；延伸見解只能標成補充。只用繁體中文純文字，不使用 Markdown 符號。`;
    let result: { model: string; text: string; durationMs: number; inputTokens: number; cachedTokens: number; outputTokens: number };
    let source = "練爭點｜模型挑戰";

    if (action === "answer") {
      const provider = (body.provider === "sol" ? "sol" : "luna") as AnswerProvider;
      const model = provider === "sol" ? await getTeachingJudgeOpenAIModel("gpt-5.6-sol") : await getOpenAIModel("gpt-5.6-luna");
      const instructions = `${shared}\n你是${provider === "sol" ? "Sol 學霸" : "Luna 助教"}。請獨立比較學生答案與老師解析，依序輸出：整體判定、答對之處、遺漏爭點、錯誤或不精確處、依老師順序整理的修正版。每項判斷都要能回到老師解析，不得只追求漂亮排版。`;
      result = await runOpenAI(model, instructions, `【題目】\n${question}\n\n【老師解析／擬答】\n${teacherAnswer}\n\n【學生答案】\n${studentAnswer || "學生尚未輸入答案。"}`);
      source = `練爭點｜${provider === "sol" ? "Sol 學霸" : "Luna 助教"}正確性分析`;
    } else if (action === "challenge") {
      const challenger = (body.challenger === "sonnet" ? "sonnet" : "terra") as Challenger;
      const lunaAnswer = clean(body.lunaAnswer, 12000);
      const solAnswer = clean(body.solAnswer, 12000);
      if (!lunaAnswer || !solAnswer) return Response.json({ error: "請先完成 Luna 與 Sol 兩份回答，再請質疑者檢核。" }, { status: 400 });
      const instructions = `${shared}\n你是${challenger === "terra" ? "Terra 擬答守門員" : "Sonnet 教學式質疑者"}。只檢查 Luna 與 Sol 回答相對於老師解析的實質偏差。每項成立的質疑必須包含：被質疑模型、原回答問題位置、對應老師解析、具體差異、可交給學生的追問句。若兩份回答都符合老師解析，必須明確回答「目前沒有成立的質疑」，不可為製造互動而挑毛病。最後指出較符合老師解析者；若兩者都有錯，明確說明。`;
      const input = `【題目】\n${question}\n\n【老師解析／擬答】\n${teacherAnswer}\n\n【學生答案】\n${studentAnswer}\n\n【Luna 回答】\n${lunaAnswer}\n\n【Sol 回答】\n${solAnswer}`;
      result = challenger === "sonnet" ? await runSonnet(instructions, input) : await runOpenAI("gpt-5.6-terra", instructions, input);
      source = `練爭點｜${challenger === "sonnet" ? "Sonnet" : "Terra"}擬答質疑者`;
    } else if (action === "reply") {
      const provider = (body.provider === "sol" ? "sol" : "luna") as AnswerProvider;
      const challenge = clean(body.challenge, 10000);
      const originalAnswer = clean(body.originalAnswer, 12000);
      if (!challenge || !originalAnswer) return Response.json({ error: "缺少要回應的質疑內容。" }, { status: 400 });
      const model = provider === "sol" ? await getTeachingJudgeOpenAIModel("gpt-5.6-sol") : await getOpenAIModel("gpt-5.6-luna");
      const instructions = `${shared}\n你是${provider === "sol" ? "Sol 學霸" : "Luna 助教"}，正在回應學生依老師擬答提出的質疑。先判斷是否接受；再指出原回答應保留、修正、補充之處；最後提供修正版。不得為維護原回答而強辯，仍須重新以老師解析校準。`;
      result = await runOpenAI(model, instructions, `【題目】\n${question}\n\n【老師解析／擬答】\n${teacherAnswer}\n\n【原回答】\n${originalAnswer}\n\n【學生採用或修改後的質疑】\n${challenge}`);
      source = `練爭點｜${provider === "sol" ? "Sol" : "Luna"}回應質疑`;
    } else return Response.json({ error: "不支援的模型挑戰動作" }, { status: 400 });

    const estimatedCostUsd = await saveUsage(result.model, result, source);
    return Response.json({ reply: result.text, model: result.model, usage: { ...result, estimatedCostUsd } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "模型挑戰暫時無法完成" }, { status: 500 });
  }
}
