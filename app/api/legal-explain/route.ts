import { getOpenAIKey, openAIJson } from "../../../lib/openai";
import { getDb } from "../../../db";
import { legalExplanationCache, usageLogs } from "../../../db/schema";
import { estimateCostUsdMicros } from "../../../lib/usage";
import { eq } from "drizzle-orm";

const EXPLANATION_PROMPT_VERSION = "legal-plain-v1";

function normalizeCacheText(value: string) {
  return value.normalize("NFKC").replace(/\s+/g, " ").trim();
}

async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function outputText(payload: Record<string, unknown>) {
  if (typeof payload.output_text === "string") return payload.output_text.trim();
  const output = Array.isArray(payload.output) ? payload.output : [];
  return output.flatMap((item) => typeof item === "object" && item && Array.isArray((item as { content?: unknown[] }).content) ? (item as { content: unknown[] }).content : []).map((item) => typeof item === "object" && item && typeof (item as { text?: unknown }).text === "string" ? (item as { text: string }).text : "").join("\n").trim();
}

type LegalAnalysis = { kind: string; officialName: string; legalField: string; nature: string; reference: string; points: string[]; verification: string; caveat: string };
type StructuredExplanation = { explanation: string; analysis: LegalAnalysis };

const responseFormat = {
  type: "json_schema",
  name: "legal_explanation",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      analysis: {
        type: "object",
        additionalProperties: false,
        properties: {
          kind: { type: "string" }, officialName: { type: "string" }, legalField: { type: "string" }, nature: { type: "string" },
          reference: { type: "string" }, points: { type: "array", items: { type: "string" } }, verification: { type: "string" }, caveat: { type: "string" },
        },
        required: ["kind", "officialName", "legalField", "nature", "reference", "points", "verification", "caveat"],
      },
      explanation: { type: "string" },
    },
    required: ["analysis", "explanation"],
  },
};

function parseStructured(text: string): StructuredExplanation | null {
  const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  try {
    const value = JSON.parse(cleaned) as { explanation?: unknown; analysis?: Partial<LegalAnalysis> };
    const explanation = typeof value.explanation === "string" ? value.explanation.trim() : "";
    if (!explanation || !value.analysis || typeof value.analysis !== "object" || Array.isArray(value.analysis)) return null;
    const points = Array.isArray(value.analysis.points) ? value.analysis.points.filter((item): item is string => typeof item === "string") : [];
    return { explanation, analysis: { kind: String(value.analysis.kind ?? ""), officialName: String(value.analysis.officialName ?? ""), legalField: String(value.analysis.legalField ?? ""), nature: String(value.analysis.nature ?? ""), reference: String(value.analysis.reference ?? ""), points, verification: String(value.analysis.verification ?? ""), caveat: String(value.analysis.caveat ?? "") } };
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { selectedText?: string; teachingLevel?: string; article?: { title?: string; articleNo?: string; content?: string } };
    const title = String(body.article?.title ?? "").slice(0, 120);
    const articleNo = String(body.article?.articleNo ?? "").slice(0, 80);
    const content = String(body.article?.content ?? "").slice(0, 6000);
    const selectedText = String(body.selectedText ?? "").slice(0, 120);
    if (!content && selectedText.length < 2) return Response.json({ error: "請先框選要解釋的文字。" }, { status: 400 });
    const model = "gpt-5.6-luna";
    const teachingLevel = normalizeCacheText(String(body.teachingLevel ?? "auto").slice(0, 40)) || "auto";
    const cacheKey = await sha256(JSON.stringify({
      version: EXPLANATION_PROMPT_VERSION,
      model,
      teachingLevel,
      selectedText: normalizeCacheText(selectedText),
      title: normalizeCacheText(title),
      articleNo: normalizeCacheText(articleNo),
      content: normalizeCacheText(content),
    }));
    try {
      const db = await getDb();
      const [cached] = await db.select().from(legalExplanationCache).where(eq(legalExplanationCache.cacheKey, cacheKey)).limit(1);
      if (cached) {
        await db.update(legalExplanationCache).set({ lastUsedAt: new Date() }).where(eq(legalExplanationCache.id, cached.id));
        return Response.json({
          explanation: cached.explanation,
          analysis: JSON.parse(cached.analysisJson) as LegalAnalysis,
          reused: true,
          usage: { model: "沿用先前解釋", inputTokens: 0, cachedTokens: 0, outputTokens: 0, durationMs: 0, estimatedCostUsd: 0 },
        });
      }
    } catch { /* 快取不可用時仍可由模型產生答案 */ }
    if (!await getOpenAIKey()) return Response.json({ error: "白話解釋模型尚未設定。" }, { status: 503 });
    const startedAt = Date.now();
    const requestBody = {
      model,
      instructions: "你是臺灣法律學習助教。辨識框選內容屬於法條、裁判字號、法律概念、學說或一般法律文字，並做考試導向的白話拆解。法規簡稱必須正規化。若能辨識條、項、款，逐層拆開。只有提供資料庫原文時，才可說已核對原文；否則應註明仍須查證，不得補造條文、裁判或題目事實。白話解釋限150至300字。",
      input: content ? `【框選文字】\n${selectedText}\n\n【已下載法規資料庫原文】\n${title} ${articleNo}\n${content}` : `【框選文字】\n${selectedText}`,
      text: { format: responseFormat },
      max_output_tokens: 1000,
    };
    let payload: Record<string, unknown> = {};
    let parsed: StructuredExplanation | null = null;
    for (let attempt = 0; attempt < 2 && !parsed; attempt++) {
      payload = await openAIJson("/responses", { method: "POST", body: JSON.stringify(requestBody) }) as Record<string, unknown>;
      parsed = parseStructured(outputText(payload));
    }
    if (!parsed) return Response.json({ error: "AI 回傳格式不完整，請再試一次。" }, { status: 502 });
    const explanation = parsed.explanation;
    if (!explanation) return Response.json({ error: "未產生可顯示的白話解釋。" }, { status: 502 });
    const usage = payload.usage && typeof payload.usage === "object" ? payload.usage as { input_tokens?: number; output_tokens?: number; input_tokens_details?: { cached_tokens?: number } } : {};
    const inputTokens = Number(usage.input_tokens ?? 0);
    const cachedTokens = Number(usage.input_tokens_details?.cached_tokens ?? 0);
    const outputTokens = Number(usage.output_tokens ?? 0);
    const estimatedCostUsdMicros = estimateCostUsdMicros(model, { inputTokens, cachedTokens, outputTokens });
    const durationMs = Date.now() - startedAt;
    try {
      const db = await getDb();
      await db.insert(legalExplanationCache).values({ cacheKey, model, explanation, analysisJson: JSON.stringify(parsed.analysis) }).onConflictDoNothing();
      await db.insert(usageLogs).values({ model, source: "全站智能框選｜白話解釋", inputTokens, cachedTokens, outputTokens, fileSearchCalls: 0, estimatedCostUsdMicros });
    } catch { /* 成本紀錄失敗不應中斷學生取得解釋 */ }
    return Response.json({ explanation, analysis: parsed.analysis, reused: false, usage: { model, inputTokens, cachedTokens, outputTokens, durationMs, estimatedCostUsd: estimatedCostUsdMicros / 1_000_000 } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "白話解釋暫時無法完成。" }, { status: 500 });
  }
}
