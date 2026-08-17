import { and, count, eq } from "drizzle-orm";
import { getOpenAIKey, openAIJson } from "../../../../lib/openai";
import { medtechPointLedger, usageLogs } from "../../../../db/schema";
import { estimateCostUsdMicros } from "../../../../lib/usage";
import { getOrCreateMedtechUsage, spendMedtechPoints } from "../../../../lib/medtech-usage";
import { requireMedtechDevice } from "../../../../lib/member-auth";

const MEDTECH_TERM_FREE_LIMIT = 3;

type MedtechAnalysis = {
  kind: string;
  officialName: string;
  legalField: string;
  nature: string;
  reference: string;
  points: string[];
  verification: string;
  caveat: string;
};

const responseFormat = {
  type: "json_schema",
  name: "medtech_term_explanation",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      analysis: {
        type: "object",
        additionalProperties: false,
        properties: {
          kind: { type: "string" },
          officialName: { type: "string" },
          legalField: { type: "string" },
          nature: { type: "string" },
          reference: { type: "string" },
          points: { type: "array", items: { type: "string" } },
          verification: { type: "string" },
          caveat: { type: "string" },
        },
        required: ["kind", "officialName", "legalField", "nature", "reference", "points", "verification", "caveat"],
      },
      explanation: { type: "string" },
    },
    required: ["analysis", "explanation"],
  },
};

function outputText(payload: Record<string, unknown>) {
  if (typeof payload.output_text === "string") return payload.output_text.trim();
  const output = Array.isArray(payload.output) ? payload.output : [];
  return output.flatMap((item) => typeof item === "object" && item && Array.isArray((item as { content?: unknown[] }).content) ? (item as { content: unknown[] }).content : []).map((item) => typeof item === "object" && item && typeof (item as { text?: unknown }).text === "string" ? (item as { text: string }).text : "").join("\n").trim();
}

function parseStructured(text: string): { explanation: string; analysis: MedtechAnalysis } | null {
  try {
    const value = JSON.parse(text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim()) as { explanation?: unknown; analysis?: Partial<MedtechAnalysis> };
    if (typeof value.explanation !== "string" || !value.explanation.trim() || !value.analysis) return null;
    return {
      explanation: value.explanation.trim(),
      analysis: {
        kind: String(value.analysis.kind ?? ""), officialName: String(value.analysis.officialName ?? ""), legalField: String(value.analysis.legalField ?? ""),
        nature: String(value.analysis.nature ?? ""), reference: String(value.analysis.reference ?? ""),
        points: Array.isArray(value.analysis.points) ? value.analysis.points.filter((item): item is string => typeof item === "string") : [],
        verification: String(value.analysis.verification ?? ""), caveat: String(value.analysis.caveat ?? ""),
      },
    };
  } catch { return null; }
}

export async function POST(request: Request) {
  try {
    const auth = await requireMedtechDevice(request);
    if ("error" in auth) return auth.error;
    const body = await request.json() as { selectedText?: string };
    const selectedText = String(body.selectedText ?? "").replace(/\s+/g, " ").trim().slice(0, 1200);
    if (selectedText.length < 2) return Response.json({ error: "請先框選要解析的醫檢名詞或內容。" }, { status: 400 });
    if (!await getOpenAIKey()) return Response.json({ error: "醫檢白話解析模型尚未設定。" }, { status: 503 });

    const usageState = await getOrCreateMedtechUsage(auth.db, auth.userKey);
    const [{ total: freeTermUses }] = await auth.db.select({ total: count() }).from(medtechPointLedger).where(and(
      eq(medtechPointLedger.userKey, auth.userKey),
      eq(medtechPointLedger.action, "term_explain_free"),
    ));
    const freeRemainingBefore = Math.max(0, MEDTECH_TERM_FREE_LIMIT - Number(freeTermUses ?? 0));
    if (freeRemainingBefore === 0 && usageState.aiCredits < 1) {
      return Response.json({ error: "名詞解析前三次免費體驗已用完；再次解析扣 1 點，請先購買點數。", code: "POINTS_EXHAUSTED", creditCost: 1, freeRemaining: 0, pointsRemaining: usageState.aiCredits, upgradeUrl: "/medtech/upgrade?reason=points" }, { status: 402 });
    }

    const model = "gpt-5.6-luna";
    const startedAt = Date.now();
    const payload = await openAIJson("/responses", {
      method: "POST",
      body: JSON.stringify({
        model,
        instructions: "你是臺灣醫事檢驗師國考的學習助教。解析使用者框選的中文或英文醫學專有名詞、縮寫、病原體名稱、檢驗方法或檢驗數值概念。先給正確的中英文全名與名詞類型，再用繁體中文說明它是什麼、臨床檢驗用途、常見縮寫或辨識方式，以及國考容易混淆的重點。英文學名保留原文並補中文；若術語有多種意思，要指出本題脈絡仍需確認，不可虛構教材原文、診斷或治療建議。白話解析限 180 至 350 字，不使用 Markdown 符號。",
        input: `【框選內容】\n${selectedText}`,
        text: { format: responseFormat },
        max_output_tokens: 1200,
      }),
    }) as Record<string, unknown>;
    const parsed = parseStructured(outputText(payload));
    if (!parsed) return Response.json({ error: "AI 回傳格式不完整，請再試一次。" }, { status: 502 });
    const rawUsage = payload.usage && typeof payload.usage === "object" ? payload.usage as { input_tokens?: number; output_tokens?: number; input_tokens_details?: { cached_tokens?: number } } : {};
    const inputTokens = Number(rawUsage.input_tokens ?? 0);
    const cachedTokens = Number(rawUsage.input_tokens_details?.cached_tokens ?? 0);
    const outputTokens = Number(rawUsage.output_tokens ?? 0);
    const estimatedCostUsdMicros = estimateCostUsdMicros(model, { inputTokens, cachedTokens, outputTokens });
    const durationMs = Date.now() - startedAt;
    try {
      await auth.db.insert(usageLogs).values({ model, source: freeRemainingBefore > 0 ? "醫檢｜框選名詞解析（免費體驗）" : "醫檢｜框選名詞解析（點數）", inputTokens, cachedTokens, outputTokens, fileSearchCalls: 0, estimatedCostUsdMicros });
    } catch { /* 成本紀錄失敗不阻擋學生取得解析 */ }

    let updatedUsage = usageState;
    let creditCost = 0;
    let freeRemaining = freeRemainingBefore;
    if (freeRemainingBefore > 0) {
      await auth.db.insert(medtechPointLedger).values({
        userKey: auth.userKey,
        delta: 0,
        balanceAfter: usageState.aiCredits,
        action: "term_explain_free",
        description: `名詞解析免費體驗（第 ${MEDTECH_TERM_FREE_LIMIT - freeRemainingBefore + 1}/${MEDTECH_TERM_FREE_LIMIT} 次）`,
        sourceDetail: `框選內容：${selectedText}`,
      });
      freeRemaining = freeRemainingBefore - 1;
    } else {
      const charged = await spendMedtechPoints(auth.db, usageState, { action: "term_explain", description: "框選名詞白話解析", sourceDetail: `框選內容：${selectedText}` });
      if (!charged) return Response.json({ error: "點數已用完；再次名詞解析扣 1 點，請先購買點數。", code: "POINTS_EXHAUSTED", creditCost: 1, freeRemaining: 0, pointsRemaining: usageState.aiCredits, upgradeUrl: "/medtech/upgrade?reason=points" }, { status: 402 });
      updatedUsage = charged;
      creditCost = 1;
    }
    return Response.json({ ...parsed, access: { freeRemaining, creditCost, pointsRemaining: updatedUsage.aiCredits }, usage: { model, inputTokens, cachedTokens, outputTokens, durationMs, estimatedCostUsd: estimatedCostUsdMicros / 1_000_000 } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "醫檢白話解析暫時無法完成。" }, { status: 500 });
  }
}
