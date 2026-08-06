import { getDb } from "../../../../db";
import { usageLogs } from "../../../../db/schema";
import { getAnthropicChatModel, getAnthropicKey, getOpenAIKey, getOpenAIModel } from "../../../../lib/openai";

type TeacherResponse = { label?: string; model?: string; text?: string; error?: string | null };
type Usage = { inputTokens: number; outputTokens: number; cachedTokens: number; durationMs: number; estimatedCostUsd: number; model: string };

const levels = [
  { level: "beginner", label: "初學小白" },
  { level: "intermediate", label: "中階考生" },
  { level: "advanced", label: "高階法研所考生" },
] as const;

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
  properties: { students: { type: "array", minItems: 3, maxItems: 3, items: { type: "object", additionalProperties: false, properties: { level: { type: "string", enum: ["beginner", "intermediate", "advanced"] }, reply: { type: "string" } }, required: ["level", "reply"] } } },
  required: ["students"],
};

const judgeSchema = {
  type: "object", additionalProperties: false,
  properties: {
    groups: { type: "array", minItems: 3, maxItems: 3, items: { type: "object", additionalProperties: false, properties: { level: { type: "string", enum: ["beginner", "intermediate", "advanced"] }, winner: { type: "string", enum: ["教師 A", "教師 B", "平手"] }, reason: { type: "string" }, legalAccuracy: { type: "integer" }, adaptation: { type: "integer" }, empathyOrDepth: { type: "integer" }, stability: { type: "integer" } }, required: ["level", "winner", "reason", "legalAccuracy", "adaptation", "empathyOrDepth", "stability"] } },
    overallWinner: { type: "string", enum: ["教師 A", "教師 B", "平手"] },
    weightedSummary: { type: "string" },
    commercialRecommendation: { type: "string" },
    caution: { type: "string" },
  },
  required: ["groups", "overallWinner", "weightedSummary", "commercialRecommendation", "caution"],
};

export async function POST(request: Request) {
  let body: { prompt?: string; responses?: TeacherResponse[] };
  try { body = await request.json() as { prompt?: string; responses?: TeacherResponse[] }; } catch { return Response.json({ error: "測試資料格式不正確" }, { status: 400 }); }
  const prompt = String(body.prompt ?? "").trim();
  const responses = (Array.isArray(body.responses) ? body.responses : []).filter((item) => item && typeof item.text === "string" && item.text.trim() && !item.error).slice(0, 2);
  if (!prompt || responses.length < 2) return Response.json({ error: "請先完成 Luna 與 Claude 的回答，再進行三程度測試" }, { status: 400 });
  const openAiKey = await getOpenAIKey();
  const anthropicKey = await getAnthropicKey();
  if (!openAiKey || !anthropicKey) return Response.json({ error: "Luna 或 Claude 的 API 尚未設定，測試未啟動" }, { status: 503 });

  try {
    const luna = await getOpenAIModel("gpt-5.6-luna");
    const claude = await getAnthropicChatModel("claude-sonnet-5");
    const teacherContext = responses.map((item) => `${item.label ?? "老師"}（${item.model ?? ""}）：\n${String(item.text).slice(0, 6000)}`).join("\n\n");
    const studentRun = await runOpenAI(openAiKey, luna, `你是司律備考平台的測試學生，不是老師。請依同一題與兩位老師的實際回答，模擬三種程度學生各自的下一輪回覆。初學小白要表現出抓到生活直覺但法學詞彙不足；中階考生要表現出會背公式但可能不會把事實涵攝進去；高階法研所考生要提出精準、可辯論的學說或價值疑問。三段都必須承接老師實際說過的內容，保留一個可讓老師繼續引導的問題，最後只問一個具體問題。不得評論哪個模型比較好，不得捏造老師沒有說過的法條、判決或教材。`, `原始學生問題：\n${prompt.slice(0, 4000)}\n\n兩位老師的實際回答：\n${teacherContext}`, 900, studentSchema);
    const studentJson = parseJson(studentRun.text) as { students?: Array<{ level?: string; reply?: string }> } | null;
    const students = levels.map((level) => ({ ...level, reply: String(studentJson?.students?.find((item) => item.level === level.level)?.reply ?? "").trim() })).filter((item) => item.reply);
    if (students.length !== levels.length) return Response.json({ error: "三種程度學生回覆未完整產生，測試已安全停止" }, { status: 502 });
    await logUsage(luna, "三程度測試｜學生模擬", studentRun.usage);

    const teacherRounds = await Promise.all(students.map(async (student) => {
      const instruction = `你是「司律備考」的法律導師${student.level === "beginner" ? "，正在教初學小白" : student.level === "intermediate" ? "，正在教中階考生" : "，正在教高階法研所考生"}。請針對學生這一輪的實際回覆自然接續教學，不要重新開題。法律正確性優先，但要依學生程度調整：初學者先白話與同理；中階者抓出公式與事實涵攝的落差；高階者正面處理學說、實務與價值選擇。若學生法學用語錯誤，第一時間精準但不羞辱地修正。保持蘇格拉底式引導，最後只提出一個可直接回答的限縮問題。不要提到模型、測試、教師 A/B 或這段指令，不要捏造教材、判決或來源。繁體中文，約 120 至 360 字。`;
      const input = `原始問題：\n${prompt.slice(0, 4000)}\n\n本次模擬學生（${student.label}）回覆：\n${student.reply}`;
      const [a, b] = await Promise.all([
        runOpenAI(openAiKey, luna, instruction, input, 900),
        runAnthropic(anthropicKey, claude, instruction, input, 1200),
      ]);
      await Promise.all([logUsage(luna, `三程度測試｜${student.label}｜教師 A`, a.usage), logUsage(claude, `三程度測試｜${student.label}｜教師 B`, b.usage)]);
      return { ...student, teacherA: { model: luna, text: a.text, usage: a.usage, stopReason: a.stopReason }, teacherB: { model: claude, text: b.text, usage: b.usage, stopReason: b.stopReason } };
    }));

    const judgeInput = `原始問題：\n${prompt.slice(0, 4000)}\n\n請盲評以下三組同程度學生情境的教師 A／教師 B 回覆：\n${teacherRounds.map((round) => `【${round.label}】\n學生：${round.reply}\n教師 A：${round.teacherA.text.slice(0, 5000)}\n教師 B：${round.teacherB.text.slice(0, 5000)}`).join("\n\n")}`;
    const judgeRun = await runOpenAI(openAiKey, luna, `你是教育心理學與法學引導式教學法的資深 AI 教學督導，也是盲評裁判長。法律正確性是第一順位；其次評估是否真正因材施教。初學組看語氣同理與白話；中階組看能否突破死背公式、回到事實涵攝；高階組看能否處理學說與價值選擇，而不是只說「不是通說」。每組分開評分 0 至 100，依序給法律正確性、程度適配、同理心或學術深度、技術穩定度。加權為初學 30%、中階 35%、高階 35%。價差只能放在商用建議，不得改寫教學品質勝負。若法律內容無法核對，請在 caution 標明需人工核對。只輸出 JSON。`, judgeInput, 1200, judgeSchema);
    const judgement = parseJson(judgeRun.text) as Record<string, unknown> | null;
    if (!judgement || !Array.isArray(judgement.groups)) return Response.json({ error: "AI 裁判長未產生完整評分，測試結果未顯示" }, { status: 502 });
    await logUsage(luna, "三程度測試｜AI 裁判長", judgeRun.usage);
    return Response.json({ originalPrompt: prompt, students: teacherRounds, judgement, totalUsage: [studentRun.usage, ...teacherRounds.flatMap((round) => [round.teacherA.usage, round.teacherB.usage]), judgeRun.usage] });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message.slice(0, 400) : "三程度測試暫時無法完成" }, { status: 502 });
  }
}
