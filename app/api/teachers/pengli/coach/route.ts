import { getDb } from "../../../../../db";
import { usageLogs } from "../../../../../db/schema";
import { estimateCostUsdMicros } from "../../../../../lib/usage";
import { getOpenAIKey, openAIJson } from "../../../../../lib/openai";
import { requireMember } from "../../../../../lib/member-auth";
import { getAiPlan } from "../../../../../lib/ai-access";
import { finishAiCoachRound, prepareAiUse } from "../../../../../lib/ai-access-gate";

type InputMessage = { role?: unknown; text?: unknown };

function isShortHelpReply(text: string) {
  return /^(我)?(不知道|不會|不懂|沒想法|想不到|請提示|給我提示|可以提示嗎)[。！!？?\s]*$/u.test(text.trim());
}

function outputText(payload: Record<string, unknown>) {
  if (typeof payload.output_text === "string") return payload.output_text.trim();
  const output = Array.isArray(payload.output) ? payload.output : [];
  return output.flatMap((item) => typeof item === "object" && item && Array.isArray((item as { content?: unknown[] }).content) ? (item as { content: unknown[] }).content : []).map((item) => typeof item === "object" && item && typeof (item as { text?: unknown }).text === "string" ? (item as { text: string }).text : "").join("\n").trim();
}

const teacherContext = `
【專屬教材】彭狸，《行政法考點（考前衝刺）演習書》，2026年二版。
【教材結構】行政法理論基礎與行政組織法、行政處分、行政契約與行政命令、行政罰法、行政執行法、訴願法與行政訴訟法、國家賠償法與損失補償、新進實務見解整理。
【目前已核對試學範圍】
1. 公私法區分：法律條文性質可由新主體說判斷；事件性質需先看原告主張的請求權基礎。釋字第758號指出，依民法第767條請求返還土地，原則上屬私法爭議，即使被告以公法關係抗辯亦不改變。老師提醒：這是基本功但不是考試熱區，先熟悉新主體說與釋字第758號。
2. 法律保留原則：以釋字第443號的層級化法律保留為核心；依人身自由、其他自由權利、技術細節與重大給付行政事項調整規範密度。地方自治事項另注意自治條例與釋字第806號。
3. 明確性原則：概念容許解釋不當然違反明確性；應從受規範者可理解、可預見及可經司法審查等方向說明。
`;

export async function POST(request: Request) {
  try {
    const gate = await prepareAiUse(request, "pengli");
    if (gate instanceof Response) return gate;
    const auth = await requireMember(request);
    if ("error" in auth) return auth.error;
    if (!await getOpenAIKey()) return Response.json({ error: "彭狸 AI 教練尚未設定模型。" }, { status: 503 });
    const body = await request.json() as { messages?: InputMessage[]; mode?: "coach" | "scholar-reflection"; requestKey?: string };
    const messages = (Array.isArray(body.messages) ? body.messages : []).slice(-12).map((message) => ({
      role: message.role === "coach" ? "assistant" : "user",
      content: String(message.text ?? "").slice(0, 4000),
    })).filter((message) => message.content.trim());
    if (!messages.length) return Response.json({ error: "請先輸入行政法問題。" }, { status: 400 });
    const reflectionMode = body.mode === "scholar-reflection";
    const lastStudentText = [...messages].reverse().find((message) => message.role === "user")?.content ?? "";
    const needsContextHint = !reflectionMode && isShortHelpReply(lastStudentText);
    const plan = await getAiPlan(auth.db);
    if (reflectionMode && plan.pengliScholarReflectionEnabled === false) return Response.json({ error: "「學霸怎麼想？」目前已由管理員關閉。" }, { status: 403 });
    const model = "gpt-5.6-luna";
    const startedAt = Date.now();
    const payload = await openAIJson("/responses", { method: "POST", body: JSON.stringify({
      model,
      instructions: reflectionMode
        ? `你是學生的反思助手，不是另一個可見角色。請根據目前老師與學生的對話，用程度良好的學生口吻產生一次完整回應，固定包含三段：「我的判斷」、「我怎麼想到的」、「我還想問老師」。第一段正面回答老師最後的問題；第二段抓出關鍵事實、規範與判斷順序；第三段只提出一個能延伸或測試反例的問題。不得宣稱是彭狸老師原文，不得顯示 Markdown 符號，控制在 350 字內。接著以彭狸 AI 教練口吻，針對這份學生回答給一段簡短回饋並繼續引導。只輸出 JSON：{"studentReply":"...","coachReply":"..."}。\n${teacherContext}`
        : `你是「彭狸 AI 教練」，是依彭狸老師教材建立的 AI 分身，不是真人老師。只能服務臺灣行政法考試學習，不得引用或混用其他司律老師教材。教學風格：先指出問題意識，再用一至兩個問題帶學生判斷，最後才整理爭點、規範、涵攝與結論。回答精簡、口語、像考前帶學生抓重點。若下列專屬教材已直接支持，結尾標示「依據：彭狸老師教材」；若問題超出目前已核對範圍，可用一般行政法知識協助，但必須標示「AI 補充，待老師教材索引核對」，不得虛構老師原文、頁碼、裁判或法條。${needsContextHint ? "學生這一輪只是表示不知道或請求提示；請直接承接上一輪老師的問題，用更小的步驟提示一個判斷入口，不要要求學生重述題目，也不要因教材頁碼未命中而拒絕回答。" : ""}\n${teacherContext}`,
      input: messages,
      max_output_tokens: reflectionMode ? 1800 : 1200,
    }) }) as Record<string, unknown>;
    const reply = outputText(payload);
    if (!reply) return Response.json({ error: "彭狸 AI 教練沒有產生可顯示的回答。" }, { status: 502 });
    const rawUsage = payload.usage && typeof payload.usage === "object" ? payload.usage as { input_tokens?: number; output_tokens?: number; input_tokens_details?: { cached_tokens?: number } } : {};
    const inputTokens = Number(rawUsage.input_tokens ?? 0);
    const cachedTokens = Number(rawUsage.input_tokens_details?.cached_tokens ?? 0);
    const outputTokens = Number(rawUsage.output_tokens ?? 0);
    const costMicros = estimateCostUsdMicros(model, { inputTokens, cachedTokens, outputTokens });
    try { const db = await getDb(); await db.insert(usageLogs).values({ model, source: reflectionMode ? "彭狸老師專區｜學霸反思" : "彭狸老師專區｜AI 分身教練", inputTokens, cachedTokens, outputTokens, fileSearchCalls: 0, estimatedCostUsdMicros: costMicros }); } catch { /* 回答不因成本紀錄失敗而中斷 */ }
    const source = /AI 補充/.test(reply) ? "AI 補充，待老師教材索引核對" : "彭狸老師教材｜專屬試學索引";
    let reflection: { studentReply: string; coachReply: string } | null = null;
    if (reflectionMode) {
      try {
        const parsed = JSON.parse(reply.replace(/^```json\s*|\s*```$/g, "")) as { studentReply?: string; coachReply?: string };
        if (!parsed.studentReply?.trim() || !parsed.coachReply?.trim()) throw new Error("INVALID_REFLECTION");
        reflection = { studentReply: parsed.studentReply.trim(), coachReply: parsed.coachReply.trim() };
      } catch { return Response.json({ error: "學霸反思格式整理失敗，請再按一次。" }, { status: 502 }); }
    }
    const round = await finishAiCoachRound(gate, { action: reflectionMode ? "pengli_scholar_reflection" : "pengli_coach_round", description: reflectionMode ? "彭狸學霸反思 1 輪" : "彭狸 AI 教練 1 輪", requestKey: body.requestKey });
    if (reflection) return Response.json({ ...reflection, source, round, usage: { model, inputTokens, cachedTokens, outputTokens, durationMs: Date.now() - startedAt, estimatedCostUsd: costMicros / 1_000_000 } });
    return Response.json({ reply, source, round, usage: { model, inputTokens, cachedTokens, outputTokens, durationMs: Date.now() - startedAt, estimatedCostUsd: costMicros / 1_000_000 } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "彭狸 AI 教練目前無法回答。" }, { status: 500 });
  }
}
