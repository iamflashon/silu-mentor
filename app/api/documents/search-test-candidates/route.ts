import { eq, sql } from "drizzle-orm";
import { getDb } from "../../../../db";
import { documentSearchUnits, documents } from "../../../../db/schema";
import { requireAdmin } from "../../../../lib/member-auth";
import { openAIJson } from "../../../../lib/openai";

function outputText(payload: Record<string, unknown>) {
  if (typeof payload.output_text === "string") return payload.output_text.trim();
  const output = Array.isArray(payload.output) ? payload.output : [];
  return output.flatMap((item) => item && typeof item === "object" && Array.isArray((item as { content?: unknown[] }).content) ? (item as { content: Array<Record<string, unknown>> }).content : [])
    .map((item) => typeof item.text === "string" ? item.text : "").join("").trim();
}

function normalized(value: string) {
  return value.normalize("NFKC").replace(/[\s「」『』、，。；：,.;:()（）]+/gu, "").toLocaleLowerCase("zh-Hant");
}

function literalFallbacks(samples: Array<{ text: string }>) {
  const phrases: string[] = [];
  for (const sample of samples) {
    for (const rawLine of sample.text.split(/\r?\n/u)) {
      const line = rawLine.replace(/^[\s\d一二三四五六七八九十百、.()（）-]+/u, "").trim();
      for (const part of line.split(/[：:；;。]/u)) {
        const phrase = part.trim().replace(/[「」『』]/gu, "");
        if (phrase.length >= 4 && phrase.length <= 16 && !/^(?:本章|第一章|參考書目|民法總則)$/u.test(phrase)) phrases.push(phrase);
      }
    }
  }
  return [...new Set(phrases)];
}

export async function POST(request: Request) {
  const auth = await requireAdmin(request);
  if ("error" in auth) return auth.error;
  const documentId = Number((await request.json().catch(() => ({})) as { documentId?: unknown }).documentId);
  if (!Number.isInteger(documentId) || documentId < 1) return Response.json({ error: "教材編號不正確" }, { status: 400 });
  const db = await getDb("primary");
  const [document] = await db.select({ id: documents.id, subject: documents.subject, fileName: documents.fileName }).from(documents).where(eq(documents.id, documentId)).limit(1);
  if (!document) return Response.json({ error: "找不到這份教材" }, { status: 404 });
  const samples = await db.select({ page: documentSearchUnits.pageStart, title: documentSearchUnits.title, text: documentSearchUnits.text })
    .from(documentSearchUnits).where(eq(documentSearchUnits.documentId, documentId)).orderBy(sql`random()`).limit(18);
  if (!samples.length) return Response.json({ error: "這份教材尚未建立頁面索引" }, { status: 409 });
  const source = samples.map((item) => `第 ${item.page ?? "?"} 頁｜${item.title}\n${item.text.slice(0, 650)}`).join("\n\n---\n\n");
  const payload = await openAIJson("/responses", {
    method: "POST",
    body: JSON.stringify({
      model: process.env.OPENAI_EXTRACTION_MODEL || process.env.OPENAI_MODEL || "gpt-5.6-luna",
      instructions: "你是教材檢索品質測試員。只能從提供的教材原文逐字複製10個彼此不同、連續出現且具有辨識度的繁體中文考點短語；不得改寫、縮寫、增字、把§改成民法第X條或補造同義詞。不要只用科目名稱，不要使用頁碼。每個查詢2至16字。",
      input: `教材：${document.fileName}\n科目：${document.subject}\n\n跨頁抽樣原文：\n${source}`,
      text: { format: { type: "json_schema", name: "search_test_candidates", strict: true, schema: { type: "object", additionalProperties: false, properties: { queries: { type: "array", minItems: 10, maxItems: 10, items: { type: "string", minLength: 2, maxLength: 16 } } }, required: ["queries"] } } },
      max_output_tokens: 500,
    }),
  }) as Record<string, unknown>;
  let queries: string[] = [];
  try { queries = (JSON.parse(outputText(payload)) as { queries?: unknown[] }).queries?.map(String) ?? []; } catch { queries = []; }
  const corpus = normalized(samples.map((item) => item.text).join("\n"));
  const literalAi = queries.map((item) => item.replace(/[「」『』]/gu, "").trim()).filter((item) => item.length >= 2 && corpus.includes(normalized(item)));
  const literalRules = literalFallbacks(samples).filter((item) => corpus.includes(normalized(item)));
  queries = [...new Set([...literalAi, ...literalRules])].slice(0, 10);
  return Response.json({ documentId, queries, sampledPages: samples.map((item) => item.page).filter(Boolean) }, { headers: { "Cache-Control": "no-store" } });
}
