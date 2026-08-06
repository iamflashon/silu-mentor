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
  properties: { level: { type: "string", enum: ["beginner", "intermediate", "advanced"] }, reply: { type: "string" } },
  required: ["level", "reply"],
};

const judgeSchema = {
  type: "object", additionalProperties: false,
  properties: {
    groups: { type: "array", minItems: 1, maxItems: 3, items: { type: "object", additionalProperties: false, properties: { level: { type: "string", enum: ["beginner", "intermediate", "advanced"] }, winner: { type: "string", enum: ["教師 A", "教師 B", "平手"] }, reason: { type: "string" }, legalAccuracy: { type: "integer" }, adaptation: { type: "integer" }, empathyOrDepth: { type: "integer" }, stability: { type: "integer" } }, required: ["level", "winner", "reason", "legalAccuracy", "adaptation", "empathyOrDepth", "stability"] } },
    overallWinner: { type: "string", enum: ["教師 A", "教師 B", "平手"] },
    weightedSummary: { type: "string" },
    commercialRecommendation: { type: "string" },
    caution: { type: "string" },
  },
  required: ["groups", "overallWinner", "weightedSummary", "commercialRecommendation", "caution"],
};

export async function POST(request: Request) {
  let body: { mode?: "level" | "judge"; level?: LevelKey; prompt?: string; responses?: TeacherResponse[]; rounds?: Array<{ level?: string; label?: string; reply?: string; teacherA?: TeacherResponse; teacherB?: TeacherResponse }> };
  try { body = await request.json() as typeof body; } catch { return Response.json({ error: "測試資料格式不正確" }, { status: 400 }); }
  const prompt = String(body.prompt ?? "").trim();
  const mode = body.mode ?? "level";
  if (mode !== "judge" && !prompt) return Response.json({ error: "請先完成學生問題與 Luna／Claude 的回答" }, { status: 400 });
  const openAiKey = await getOpenAIKey();
  if (!openAiKey) return Response.json({ error: "Luna 的 API 尚未設定，測試未啟動" }, { status: 503 });

  try {
    const luna = await getOpenAIModel("gpt-5.6-luna");
    if (mode === "judge") {
      const rounds = (Array.isArray(body.rounds) ? body.rounds : []).filter((round) => round && round.level && round.reply && round.teacherA?.text && round.teacherB?.text).slice(0, 3);
      if (!rounds.length) return Response.json({ error: "請先完成至少一種程度的教師接續回答，再按 AI 審判長評比" }, { status: 400 });
      // Keep the judging request compact. The tutor turns can include long retrieval context,
      // while the judge only needs the student's actual follow-up and each teacher's answer.
      // A smaller request prevents the hosted request from timing out on mobile connections.
      const judgeInput = rounds.map((round) => `【${round.label ?? round.level}】\n學生：${String(round.reply).slice(0, 1400)}\n教師 A：${String(round.teacherA?.text).slice(0, 2200)}\n教師 B：${String(round.teacherB?.text).slice(0, 2200)}`).join("\n\n");
      const judgeRun = await runOpenAI(openAiKey, luna, `你是教育心理學與法學引導式教學法的資深 AI 教學督導。請盲評實際提供的組別，法律正確性優先，其次才是因材施教。初學組評白話與同理；中階組評事實涵攝指引；高階組評學說、實務與價值思辯。每組各給法律正確性、程度適配、同理心或學術深度、技術穩定度四項 0 至 100 分，並判定教師 A、教師 B或平手。只有完整三組時才按初學 30%、中階 35%、高階 35% 加權；部分組別須明說總評範圍。價差只影響商用建議，不得改寫教學品質勝負。無法核對法律內容時，在 caution 標示需人工核對。理由務必精簡，只輸出 JSON。`, judgeInput, 520 + rounds.length * 120, judgeSchema);
      const judgement = parseJson(judgeRun.text) as Record<string, unknown> | null;
      if (!judgement || !Array.isArray(judgement.groups)) return Response.json({ error: "AI 審判長未產生完整評分，結果未顯示" }, { status: 502 });
      await logUsage(luna, "程度測試｜AI 審判長", judgeRun.usage);
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
