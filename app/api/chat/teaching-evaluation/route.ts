import { getDb } from "../../../../db";
import { usageLogs } from "../../../../db/schema";
import { getAnthropicChatModel, getAnthropicKey, getOpenAIKey, getOpenAIModel, getTeachingJudgeOpenAIModel } from "../../../../lib/openai";

type TeacherResponse = { label?: string; model?: string; text?: string; error?: string | null };
type JudgeSelection = { key?: string; kind?: "student" | "teacher"; label?: string; model?: string; text?: string };
type Usage = { inputTokens: number; outputTokens: number; cachedTokens: number; durationMs: number; estimatedCostUsd: number; model: string };

const levels = [
  { level: "beginner", label: "初學小白" },
  { level: "intermediate", label: "中階考生" },
  { level: "advanced", label: "高階法研所考生" },
  { level: "super", label: "超級學霸" },
] as const;
type LevelKey = (typeof levels)[number]["level"];

const modelRates: Record<string, { input: number; cached: number; output: number }> = {
  "gpt-5.6-luna": { input: 0.10, cached: 0.01, output: 0.60 },
  "gpt-5.6-terra": { input: 1.00, cached: 0.10, output: 6.00 },
  "gpt-5.6-sol": { input: 2.50, cached: 0.25, output: 15.00 },
};

function anthropicRates(model: string) {
  if (/opus/i.test(model)) return { input: 5, output: 25 };
  if (/haiku/i.test(model)) return { input: 1, output: 5 };
  if (/sonnet-5/i.test(model)) return { input: 2, output: 10 };
  return { input: 3, output: 15 };
}

function outputText(payload: unknown) {
  if (!payload || typeof payload !== "object") return "";
  const output = (payload as { output?: unknown[] }).output;
  if (!Array.isArray(output)) return "";
  return output.flatMap((item) => {
    if (!item || typeof item !== "object" || !Array.isArray((item as { content?: unknown[] }).content)) return [];
    return ((item as { content: unknown[] }).content).map((part) => part && typeof part === "object" ? String((part as { text?: unknown }).text ?? "") : "");
  }).join("").trim();
}

function anthropicText(payload: unknown) {
  if (!payload || typeof payload !== "object" || !Array.isArray((payload as { content?: unknown[] }).content)) return "";
  return ((payload as { content: unknown[] }).content).map((part) => part && typeof part === "object" ? String((part as { text?: unknown }).text ?? "") : "").join("").trim();
}

function parseJson(text: string): unknown {
  const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  try { return JSON.parse(cleaned); } catch { /* try the first complete JSON object */ }
  const start = Math.min(...[cleaned.indexOf("{"), cleaned.indexOf("[")].filter((value) => value >= 0));
  const end = Math.max(cleaned.lastIndexOf("}"), cleaned.lastIndexOf("]"));
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(cleaned.slice(start, end + 1)); } catch { return null; }
}

function readUsage(payload: unknown) {
  const usage = payload && typeof payload === "object" ? (payload as { usage?: Record<string, unknown> }).usage : null;
  const details = usage?.input_tokens_details && typeof usage.input_tokens_details === "object" ? usage.input_tokens_details as Record<string, unknown> : null;
  return { inputTokens: Number(usage?.input_tokens ?? 0), outputTokens: Number(usage?.output_tokens ?? 0), cachedTokens: Number(details?.cached_tokens ?? 0) };
}

function cost(model: string, usage: { inputTokens: number; outputTokens: number; cachedTokens: number }) {
  if (/^claude/i.test(model)) {
    const rates = anthropicRates(model);
    return (usage.inputTokens * rates.input + usage.outputTokens * rates.output) / 1_000_000;
  }
  const rates = modelRates[model] ?? modelRates["gpt-5.6-luna"];
  return ((Math.max(0, usage.inputTokens - usage.cachedTokens) * rates.input) + usage.cachedTokens * rates.cached + usage.outputTokens * rates.output) / 1_000_000;
}

async function logUsage(model: string, source: string, usage: Usage) {
  try {
    const db = await getDb();
    await db.insert(usageLogs).values({ model, source, inputTokens: usage.inputTokens, cachedTokens: usage.cachedTokens, outputTokens: usage.outputTokens, fileSearchCalls: 0, estimatedCostUsdMicros: Math.round(usage.estimatedCostUsd * 1_000_000) });
  } catch {
    // Usage logging must not discard a completed teaching evaluation.
  }
}

async function runOpenAI(apiKey: string, model: string, instructions: string, input: string, maxOutputTokens: number, jsonSchema?: Record<string, unknown>) {
  const startedAt = Date.now();
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({ model, instructions, input, max_output_tokens: maxOutputTokens, ...(jsonSchema ? { text: { format: { type: "json_schema", name: "teaching_evaluation", strict: true, schema: jsonSchema } } } : {}) }),
  });
  const payload = await response.json() as Record<string, unknown>;
  if (!response.ok) throw new Error(String((payload.error as { message?: string } | undefined)?.message ?? "OpenAI 回覆失敗").slice(0, 300));
  const usage = readUsage(payload);
  const result: Usage = { model, ...usage, durationMs: Date.now() - startedAt, estimatedCostUsd: cost(model, usage) };
  return { text: outputText(payload), usage: result, stopReason: String((payload as { status?: unknown }).status ?? "") || null };
}

async function runAnthropic(apiKey: string, model: string, instructions: string, input: string, maxTokens: number) {
  const startedAt = Date.now();
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model, system: instructions, max_tokens: maxTokens, messages: [{ role: "user", content: input }] }),
  });
  const payload = await response.json() as Record<string, unknown>;
  if (!response.ok) throw new Error(String((payload.error as { message?: string } | undefined)?.message ?? "Claude Sonnet 回覆失敗").slice(0, 300));
  const usage = payload.usage && typeof payload.usage === "object" ? payload.usage as Record<string, unknown> : {};
  const measured = { inputTokens: Number(usage.input_tokens ?? 0), outputTokens: Number(usage.output_tokens ?? 0), cachedTokens: 0 };
  const result: Usage = { model, ...measured, durationMs: Date.now() - startedAt, estimatedCostUsd: cost(model, measured) };
  return { text: anthropicText(payload), usage: result, stopReason: String((payload as { stop_reason?: unknown }).stop_reason ?? "") || null };
}

const studentSchema = {
  type: "object", additionalProperties: false,
  properties: { level: { type: "string", enum: ["beginner", "intermediate", "advanced", "super"] }, reply: { type: "string" } },
  required: ["level", "reply"],
};

const judgeSchema = {
  type: "object", additionalProperties: false,
  properties: {
    groups: { type: "array", minItems: 1, maxItems: 4, items: { type: "object", additionalProperties: false, properties: { level: { type: "string", enum: ["general", "beginner", "intermediate", "advanced", "super"] }, winner: { type: "string" }, reason: { type: "string" }, legalAccuracy: { type: "integer" }, adaptation: { type: "integer" }, empathyOrDepth: { type: "integer" }, stability: { type: "integer" } }, required: ["level", "winner", "reason", "legalAccuracy", "adaptation", "empathyOrDepth", "stability"] } },
    overallWinner: { type: "string" },
    weightedSummary: { type: "string" },
    commercialRecommendation: { type: "string" },
    caution: { type: "string" },
    dialogue: { type: "string" },
  },
  required: ["groups", "overallWinner", "weightedSummary", "commercialRecommendation", "caution", "dialogue"],
};

export async function POST(request: Request) {
  let body: { mode?: "level" | "judge" | "judge-followup"; level?: LevelKey; prompt?: string; question?: string; responses?: TeacherResponse[]; selections?: JudgeSelection[]; rounds?: Array<{ level?: string; label?: string; reply?: string; teacherA?: TeacherResponse; teacherB?: TeacherResponse }>; judgement?: Record<string, unknown>; history?: Array<{ role?: string; text?: string }> };
  try { body = await request.json() as typeof body; } catch { return Response.json({ error: "測試資料格式不正確" }, { status: 400 }); }
  const prompt = String(body.prompt ?? "").trim();
  const mode = body.mode ?? "level";
  if (mode === "level" && !prompt) return Response.json({ error: "請先完成學生問題與 Luna／Claude 的回答" }, { status: 400 });
  if (mode === "judge-followup") return Response.json({ error: "Sol 審判長是單次測試工具，不開放繼續追問；請重新勾選內容後再評比" }, { status: 410 });
  const openAiKey = await getOpenAIKey();
  if (!openAiKey) return Response.json({ error: "Luna 的 API 尚未設定，測試未啟動" }, { status: 503 });

  try {
    const luna = await getOpenAIModel("gpt-5.6-luna");
    if (mode === "judge") {
      const judgeModel = await getTeachingJudgeOpenAIModel("gpt-5.6-sol");
      const selections = (Array.isArray(body.selections) ? body.selections : []).filter((item) => item && (item.kind === "student" || item.kind === "teacher") && typeof item.text === "string" && item.text.trim()).slice(0, 12);
      if (!selections.length) return Response.json({ error: "請先勾選至少一段學生問題或老師回答，再按 Sol 審判長評比" }, { status: 400 });
      const judgeInput = selections.map((item, index) => {
        const kindLabel = item.kind === "student" ? "學生問題" : `老師回答｜${item.label ?? "未標示模型"}`;
        const modelLabel = item.model ? `（${item.model}）` : "";
        return `【選取 ${index + 1}｜${kindLabel}${modelLabel}】\n${String(item.text).slice(0, 5000)}`;
      }).join("\n\n");
      const inputChars = judgeInput.length;
      const judgeRun = await runOpenAI(openAiKey, judgeModel, `你是「Sol 審判長」，現在執行一項獨立的 AI 教學品質測試。你只能分析下方明確勾選的內容，不得自行讀取或推測聊天室其他內容，也不得虛構未提供的另一位老師。法律正確性優先，其次評估學生程度適配、論證完整度、同理心或學術深度與技術穩定性。

請把學生問題與老師回答視為測試材料：指出 Luna 或 Claude Sonnet 真正抓到的法律死穴、加分亮點、遺漏、可能誤導處與可直接改寫的考場寫法。若只有單一模型，直接評論單一模型；只有同時提供兩位老師內容時才比較優劣。若勾選內容缺少學生問題或缺少老師回答，請明確說明判斷限制。不要把自己寫成可對話的第三位老師，不要邀請追問，不要提出下一個問題。輸出繁體中文、自然但完整的測試評語，並只輸出符合指定 JSON schema 的內容。`, judgeInput, 1200, judgeSchema);
      const judgement = parseJson(judgeRun.text) as Record<string, unknown> | null;
      if (!judgement || !Array.isArray(judgement.groups)) return Response.json({ error: "AI 審判長未產生完整評比；這次勾選資料已保留，請稍後重試" }, { status: 502 });
      await logUsage(judgeModel, "程度測試｜Sol 審判長｜勾選評比", judgeRun.usage);
      return Response.json({ originalPrompt: prompt, judgement, totalUsage: [judgeRun.usage], diagnostics: { selectedItems: selections.length, inputChars, estimatedInputTokens: Math.ceil(inputChars / 4), inputTokens: judgeRun.usage.inputTokens, cachedTokens: judgeRun.usage.cachedTokens, outputTokens: judgeRun.usage.outputTokens, durationMs: judgeRun.usage.durationMs, estimatedCostUsd: judgeRun.usage.estimatedCostUsd, model: judgeRun.usage.model } });
    }
    if (mode === "judge" || mode === "judge-followup") {
      const judgeModel = await getTeachingJudgeOpenAIModel("gpt-5.6-sol");
      const rounds = (Array.isArray(body.rounds) ? body.rounds : []).filter((round) => round && round.level && round.reply && (round.teacherA?.text || round.teacherB?.text)).slice(0, 4);
      if (!rounds.length) return Response.json({ error: "請先完成至少一種程度的教師接續回答，再按 Sol 審判長評比" }, { status: 400 });
      // Keep the judging request compact. The tutor turns can include long retrieval context,
      // while the judge only needs the student's actual follow-up and each teacher's answer.
      // A smaller request prevents the hosted request from timing out on mobile connections.
      const judgeInput = rounds.map((round) => {
        const teachers = [round.teacherA, round.teacherB].filter((teacher): teacher is TeacherResponse => Boolean(teacher?.text));
        const teacherText = teachers.map((teacher) => `${teacher.label ?? (/claude/i.test(teacher.model ?? "") ? "Claude Sonnet" : "Luna")}（${teacher.model ?? ""}）：${String(teacher.text).slice(0, 2400)}`).join("\n");
        return `【${round.label ?? round.level}】\n學生：${String(round.reply).slice(0, 1400)}\n${teacherText}`;
      }).join("\n\n");
      if (mode === "judge-followup") {
        const question = String(body.question ?? "").trim();
        if (!question) return Response.json({ error: "請輸入要追問 Sol 審判長的問題" }, { status: 400 });
        const history = (Array.isArray(body.history) ? body.history : []).filter((item) => item && typeof item.text === "string" && item.text.trim()).slice(-6).map((item) => `${item.role === "judge" ? "Sol 審判長" : "使用者"}：${String(item.text).slice(0, 1800)}`).join("\n\n");
        const judgement = body.judgement && typeof body.judgement === "object" ? JSON.stringify(body.judgement).slice(0, 7000) : "";
        const followupRun = await runOpenAI(openAiKey, judgeModel, `你是「Sol 審判長」，也是資深司律閱卷教授與 AI 教學督導。你正在主對話框中與測試者持續對話。請直接回答這次追問，必須依已提供的實際模型回答與你的既有裁決；若只有一位老師，不得虛構另一位老師的內容。法律正確性優先；若問題涉及學說，說清楚理論位置、實際法律效果與考場寫法。若測試者問商用選擇，分開評估教學品質、成本與適用學生。繁體中文、自然對話，不用 JSON，不要變成制式評分表；可以使用簡短段落，但最後只留一個最有用的下一步追問。`, `本次受評內容：\n${judgeInput}\n\n既有裁決：\n${judgement}\n\n近期審判長對話：\n${history}\n\n測試者現在追問：\n${question.slice(0, 2400)}`, 1100);
        await logUsage(judgeModel, "程度測試｜Sol 審判長追問", followupRun.usage);
        return Response.json({ reply: followupRun.text, totalUsage: [followupRun.usage] });
      }
      const judgeRun = await runOpenAI(openAiKey, judgeModel, `你是「Sol 審判長」，兼具資深司律閱卷教授、刑法學教師與 AI 教學督導身分。請評比實際提供的 Luna 與 Claude Sonnet 回答，法律正確性優先，其次才是因材施教。若某一組只有一位老師，絕對不要虛構另一位老師的回答；直接針對實際存在的單一模型評論其優點、漏洞、遺漏與考場教學價值。只有同時存在 Luna 與 Claude Sonnet 時，才比較誰較好。

初學組：檢查是否先安撫挫折、以極白話但法律上精準的例子澄清直覺；特別注意不可把「誤想防衛」錯講成一般的打錯對象或不知打到人。
中階組：檢查是否拒絕直接給滿分，並抓出只背公式、沒有帶入未開燈、環境昏暗、攻擊手段、錯誤可避免性與結果關聯等具體事實的問題。
高階組：檢查是否能正面處理嚴格罪責理論與限縮法律效果罪責理論，不得以「通說」壓過異說；要說清楚構成要件故意、故意罪責、禁止錯誤、可避免性，以及留下故意傷害責任與改論過失責任之實質利益差異。
超級學霸組：評估體系整合、反例辨識、概念精確度與回應高難度追問的能力。
一般對話組：直接檢查本輪回答的法律正確性、論證完整度、教材依據與是否真正回應學生問題。

每組給法律正確性、程度適配、同理心或學術深度、技術穩定度四項 0 至 100 分；單一模型時 winner 請填實際模型名稱，雙模型時才填 Luna、Claude Sonnet 或平手。完整初學、中階、高階三組時按 30%、35%、35% 加權；超級學霸另列壓力測試。價差只影響商用建議，不得改寫品質勝負。

dialogue 欄位必須是一段可以直接出現在主對話框的自然評語，雙模型時標題從「兩位老師的期末大抓漏」開始，依序用「1. Luna」與「2. Claude Sonnet」；單一模型時標題從「單一模型回答的期末大抓漏」開始，只評論實際存在的模型，單一模型時只評論實際存在的模型，說明其真正抓到的申論死穴、加分亮點、遺漏或可能誤導處，必須引用實際回答的具體內容，像資深總閱卷老師講評，而不是只報分數。最後用「Sol 審判長結論」說明本輪誰較好、各自最適合的教學任務，以及下一輪應該怎麼驗證。只輸出符合 schema 的 JSON。`, judgeInput, 900 + rounds.length * 180, judgeSchema);
      const judgement = parseJson(judgeRun.text) as Record<string, unknown> | null;
      if (!judgement || !Array.isArray(judgement.groups)) return Response.json({ error: "AI 審判長未產生完整評分，結果未顯示" }, { status: 502 });
      await logUsage(judgeModel, "程度測試｜Sol 審判長", judgeRun.usage);
      return Response.json({ originalPrompt: prompt, judgement, totalUsage: [judgeRun.usage] });
    }

    const selectedLevel = levels.find((item) => item.level === body.level);
    const responses = (Array.isArray(body.responses) ? body.responses : []).filter((item) => item && typeof item.text === "string" && item.text.trim() && !item.error).slice(0, 2);
    if (!selectedLevel) return Response.json({ error: "請選擇要測試的學生程度" }, { status: 400 });
    if (responses.length < 2) return Response.json({ error: "請先完成 Luna 與 Claude 的回答，再進行程度測試" }, { status: 400 });
    const anthropicKey = await getAnthropicKey();
    if (!anthropicKey) return Response.json({ error: "Claude 的 API 尚未設定，測試未啟動" }, { status: 503 });
    const claude = await getAnthropicChatModel("claude-sonnet-5");
    const teacherContext = responses.map((item) => `${item.label ?? "老師"}（${item.model ?? ""}）：\n${String(item.text).slice(0, 6000)}`).join("\n\n");
    const studentRun = await runOpenAI(openAiKey, luna, `你是司律備考平台的測試學生，不是老師。請依同一題與兩位老師的實際回答，模擬「${selectedLevel.label}」學生的下一輪回覆。${selectedLevel.level === "beginner" ? "抓到生活直覺但法學詞彙不足，需要白話引導。" : selectedLevel.level === "intermediate" ? "會背公式但可能不會把事實涵攝進去，提出一個需要具體帶入事實的問題。" : "提出精準、可辯論的學說或價值疑問，要求老師處理不同見解。"}必須承接老師實際說過的內容，保留一個可讓老師繼續引導的問題，最後只問一個具體問題。不得評論哪個模型比較好，不得捏造老師沒有說過的法條、判決或教材。只輸出 JSON。`, `原始學生問題：\n${prompt.slice(0, 4000)}\n\n兩位老師的實際回答：\n${teacherContext}`, 900, studentSchema);
    const studentJson = parseJson(studentRun.text) as { level?: string; reply?: string } | null;
    const reply = String(studentJson?.reply ?? "").trim();
    if (!reply) return Response.json({ error: `${selectedLevel.label}學生回覆未完整產生，測試已安全停止` }, { status: 502 });
    await logUsage(luna, `程度測試｜${selectedLevel.label}｜學生模擬`, studentRun.usage);
    const instruction = `你是「司律備考」的法律導師，正在教${selectedLevel.label}。請針對學生這一輪的實際回覆自然接續教學，不要重新開題。法律正確性優先，但要依學生程度調整：初學者先白話與同理；中階者抓出公式與事實涵攝的落差；高階者正面處理學說、實務與價值選擇。若學生法學用語錯誤，第一時間精準但不羞辱地修正。保持蘇格拉底式引導，最後只提出一個可直接回答的限縮問題。不要提到模型、測試、教師 A/B 或這段指令，不要捏造教材、判決或來源。繁體中文，約 120 至 360 字。`;
    const input = `原始問題：\n${prompt.slice(0, 4000)}\n\n本次模擬學生（${selectedLevel.label}）回覆：\n${reply}`;
    const [a, b] = await Promise.all([runOpenAI(openAiKey, luna, instruction, input, 900), runAnthropic(anthropicKey, claude, instruction, input, 1200)]);
    await Promise.all([logUsage(luna, `程度測試｜${selectedLevel.label}｜教師 A`, a.usage), logUsage(claude, `程度測試｜${selectedLevel.label}｜教師 B`, b.usage)]);
    const student = { ...selectedLevel, reply, teacherA: { model: luna, text: a.text, usage: a.usage, stopReason: a.stopReason }, teacherB: { model: claude, text: b.text, usage: b.usage, stopReason: b.stopReason } };
    return Response.json({ originalPrompt: prompt, student, totalUsage: [studentRun.usage, a.usage, b.usage] });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message.slice(0, 400) : "程度測試暫時無法完成" }, { status: 502 });
  }
}
