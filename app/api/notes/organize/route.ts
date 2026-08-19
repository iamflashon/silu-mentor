import { getOpenAIKey, openAIJson } from "../../../../lib/openai";
import { getDb } from "../../../../db";
import { organizedNoteCache, usageLogs } from "../../../../db/schema";
import { estimateCostUsdMicros } from "../../../../lib/usage";
import { eq } from "drizzle-orm";

const NOTE_PROMPT_VERSION = "structured-note-v1";

function normalizeCacheText(value: string) { return value.normalize("NFKC").replace(/\s+/g, " ").trim(); }
async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function outputText(payload: Record<string, unknown>) {
  if (typeof payload.output_text === "string") return payload.output_text.trim();
  const output = Array.isArray(payload.output) ? payload.output : [];
  return output.flatMap((item) => typeof item === "object" && item && Array.isArray((item as { content?: unknown[] }).content) ? (item as { content: unknown[] }).content : []).map((item) => typeof item === "object" && item && typeof (item as { text?: unknown }).text === "string" ? (item as { text: string }).text : "").join("\n").trim();
}

type OrganizedNote = { title: string; subject: string; tags: string; issue: string; rule: string; application: string; conclusion: string };

const responseFormat = {
  type: "json_schema",
  name: "organized_study_note",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      title: { type: "string" },
      subject: { type: "string" },
      tags: { type: "string" },
      issue: { type: "string" },
      rule: { type: "string" },
      application: { type: "string" },
      conclusion: { type: "string" },
    },
    required: ["title", "subject", "tags", "issue", "rule", "application", "conclusion"],
  },
};

function parseNote(text: string): OrganizedNote | null {
  const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  try {
    const value = JSON.parse(cleaned) as Partial<OrganizedNote>;
    const note = {
      title: String(value.title ?? "").trim(), subject: String(value.subject ?? "").trim(), tags: String(value.tags ?? "").trim(),
      issue: String(value.issue ?? "").trim(), rule: String(value.rule ?? "").trim(), application: String(value.application ?? "").trim(), conclusion: String(value.conclusion ?? "").trim(),
    };
    return note.title && note.issue && note.rule && note.application && note.conclusion ? note : null;
  } catch { return null; }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { title?: string; content?: string; subject?: string; tags?: string; sourceLabel?: string };
    const content = String(body.content ?? "").trim().slice(0, 12000);
    if (content.length < 2) return Response.json({ error: "目前沒有可整理的內容。" }, { status: 400 });
    const model = "gpt-5.6-luna";
    const cacheKey = await sha256(JSON.stringify({ version: NOTE_PROMPT_VERSION, model, title: normalizeCacheText(String(body.title ?? "")), subject: normalizeCacheText(String(body.subject ?? "綜合")), tags: normalizeCacheText(String(body.tags ?? "")), sourceLabel: normalizeCacheText(String(body.sourceLabel ?? "")), content: normalizeCacheText(content) }));
    try {
      const db = await getDb();
      const [cached] = await db.select().from(organizedNoteCache).where(eq(organizedNoteCache.cacheKey, cacheKey)).limit(1);
      if (cached) {
        const note = JSON.parse(cached.noteJson) as OrganizedNote;
        await db.update(organizedNoteCache).set({ lastUsedAt: new Date() }).where(eq(organizedNoteCache.id, cached.id));
        return Response.json({ note: { title: note.title, subject: note.subject || String(body.subject ?? "綜合"), tags: note.tags || "待複習", content: `【爭點】\n${note.issue}\n\n【規範】\n${note.rule}\n\n【涵攝】\n${note.application}\n\n【結論】\n${note.conclusion}`, sourceLabel: String(body.sourceLabel ?? "AI 法律助教") }, reused: true, usage: { model: "沿用先前整理", inputTokens: 0, cachedTokens: 0, outputTokens: 0, durationMs: 0, estimatedCostUsd: 0 } });
      }
    } catch { /* 快取不可用時仍可由模型整理 */ }
    if (!await getOpenAIKey()) return Response.json({ error: "AI 筆記整理模型尚未設定。" }, { status: 503 });
    const startedAt = Date.now();
    const payload = await openAIJson("/responses", {
      method: "POST",
      body: JSON.stringify({
        model,
        instructions: "你是臺灣司律考試的法律筆記助教。請忠於提供內容，整理成可複習、可編輯的考試筆記。爭點要寫成具體法律問題；規範整理條文、要件、判準或學說；涵攝只可使用原文已有事實。若內容只有法條、概念或抽象說明而無案例事實，涵攝必須明確寫『目前未提供具體案例事實，尚待依個案涵攝』，不得虛構人物、行為或結論；結論則整理原文可支持的法律效果或答題方向。不要聲稱已核對未提供的資料，不要加入來源沒有的法條或裁判。標籤以頓號分隔，2至4個。",
        input: `【原標題】\n${String(body.title ?? "").slice(0, 160)}\n\n【原科目】\n${String(body.subject ?? "綜合").slice(0, 80)}\n\n【原標籤】\n${String(body.tags ?? "").slice(0, 120)}\n\n【來源】\n${String(body.sourceLabel ?? "").slice(0, 240)}\n\n【待整理原文】\n${content}`,
        text: { format: responseFormat },
        max_output_tokens: 1400,
      }),
    }) as Record<string, unknown>;
    const note = parseNote(outputText(payload));
    if (!note) return Response.json({ error: "AI 未能產生完整的結構化筆記，請再試一次。" }, { status: 502 });

    const usage = payload.usage && typeof payload.usage === "object" ? payload.usage as { input_tokens?: number; output_tokens?: number; input_tokens_details?: { cached_tokens?: number } } : {};
    const inputTokens = Number(usage.input_tokens ?? 0), cachedTokens = Number(usage.input_tokens_details?.cached_tokens ?? 0), outputTokens = Number(usage.output_tokens ?? 0);
    const estimatedCostUsdMicros = estimateCostUsdMicros(model, { inputTokens, cachedTokens, outputTokens });
    try {
      const db = await getDb();
      await db.insert(organizedNoteCache).values({ cacheKey, model, noteJson: JSON.stringify(note) }).onConflictDoNothing();
      await db.insert(usageLogs).values({ model, source: "我的筆記｜AI 結構化整理", inputTokens, cachedTokens, outputTokens, fileSearchCalls: 0, estimatedCostUsdMicros });
    } catch { /* 成本紀錄失敗不影響筆記預覽 */ }

    return Response.json({
      note: { title: note.title, subject: note.subject || String(body.subject ?? "綜合"), tags: note.tags || "待複習", content: `【爭點】\n${note.issue}\n\n【規範】\n${note.rule}\n\n【涵攝】\n${note.application}\n\n【結論】\n${note.conclusion}`, sourceLabel: String(body.sourceLabel ?? "AI 法律助教") },
      reused: false, usage: { model, inputTokens, cachedTokens, outputTokens, durationMs: Date.now() - startedAt, estimatedCostUsd: estimatedCostUsdMicros / 1_000_000 },
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "AI 筆記整理暫時無法完成。" }, { status: 500 });
  }
}
