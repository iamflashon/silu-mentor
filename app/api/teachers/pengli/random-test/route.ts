import { and, desc, eq, like, or } from "drizzle-orm";
import { getDb } from "../../../../../db";
import { documentAssignments, documents } from "../../../../../db/schema";
import { requireMember } from "../../../../../lib/member-auth";
import { getOpenAIKey, openAIJson } from "../../../../../lib/openai";

function outputText(payload: Record<string, unknown>) {
  if (typeof payload.output_text === "string") return payload.output_text.trim();
  const output = Array.isArray(payload.output) ? payload.output : [];
  return output.flatMap((item) => item && typeof item === "object" && Array.isArray((item as { content?: unknown[] }).content)
    ? (item as { content: Array<Record<string, unknown>> }).content
    : []).map((item) => typeof item.text === "string" ? item.text : "").join("").trim();
}

const themeTitles = ["行政法理論基礎與行政組織法", "行政處分", "行政契約與行政命令", "行政罰法", "行政執行法", "訴願法與行政訴訟法", "國家賠償法與損失補償", "新進實務見解整理"];

function themeIndex(topic: string) {
  const normalized = topic.normalize("NFKC");
  return themeTitles.findIndex((title) => normalized.includes(title) || title.includes(normalized));
}

function themeStart(records: Array<{ page: number; text: string }>, title: string) {
  return records.filter((record) => record.text.includes(title)).sort((left, right) => {
    const leftOtherThemes = themeTitles.filter((item) => left.text.includes(item)).length;
    const rightOtherThemes = themeTitles.filter((item) => right.text.includes(item)).length;
    const leftOpening = left.text.slice(0, 220).includes(title) ? 0 : 1;
    const rightOpening = right.text.slice(0, 220).includes(title) ? 0 : 1;
    return leftOtherThemes - rightOtherThemes || leftOpening - rightOpening || left.page - right.page;
  })[0]?.page ?? null;
}

export async function POST(request: Request) {
  const auth = await requireMember(request);
  if ("error" in auth) return auth.error;
  if (!await getOpenAIKey()) return Response.json({ error: "尚未設定 AI 模型。" }, { status: 503 });

  const db = await getDb("primary");
  const assigned = await db.select({ id: documents.id, title: documents.bookTitle, fileName: documents.fileName, storageKey: documents.storageKey })
    .from(documentAssignments)
    .innerJoin(documents, eq(documents.id, documentAssignments.documentId))
    .where(and(eq(documentAssignments.examCategory, "pengli"), eq(documentAssignments.aiSearchEnabled, true)))
    .orderBy(desc(documents.id)).limit(10);
  const direct = await db.select({ id: documents.id, title: documents.bookTitle, fileName: documents.fileName, storageKey: documents.storageKey })
    .from(documents)
    .where(or(like(documents.fileName, "%59ML170502%"), like(documents.bookTitle, "%行政法考點%")))
    .orderBy(desc(documents.id)).limit(10);
  const books = [...new Map([...assigned, ...direct].map((book) => [book.id, book])).values()];
  if (!books.length) return Response.json({ error: "尚未找到彭狸老師教材。" }, { status: 409 });

  const requestedTopic = String((await request.json().catch(() => ({})) as { topic?: unknown }).topic ?? "").trim();
  const book = books[0];
  if (!/\.local-index\.jsonl$/iu.test(book.fileName)) return Response.json({ error: "目前這項真實頁碼測試需要原始逐頁索引檔。" }, { status: 409 });
  const { env } = await import("cloudflare:workers");
  const object = await env.BUCKET?.get(book.storageKey);
  if (!object) return Response.json({ error: "找不到教材原始逐頁索引檔。" }, { status: 404 });
  const raw = new TextDecoder("utf-8", { fatal: false }).decode(await object.arrayBuffer()).replace(/^\uFEFF/u, "");
  const records = raw.split(/\r?\n/u).map((line, index) => {
    try {
      const record = JSON.parse(line) as { page_start?: unknown; page_end?: unknown; title?: unknown; text?: unknown };
      const text = typeof record.text === "string" ? record.text.replace(/\\n/gu, "\n").trim() : "";
      return text ? { page: Number(record.page_start) || index + 1, pageEnd: Number(record.page_end) || Number(record.page_start) || index + 1, title: String(record.title ?? ""), text } : null;
    } catch { return null; }
  }).filter((record): record is { page: number; pageEnd: number; title: string; text: string } => Boolean(record));
  if (!records.length) return Response.json({ error: "原始逐頁索引檔沒有可核對內容。" }, { status: 409 });

  const selectedThemeIndex = themeIndex(requestedTopic);
  const startPage = selectedThemeIndex >= 0 ? themeStart(records, themeTitles[selectedThemeIndex]) : null;
  const nextPage = selectedThemeIndex >= 0 && selectedThemeIndex < themeTitles.length - 1 ? themeStart(records, themeTitles[selectedThemeIndex + 1]) : null;
  const scoped = records.filter((record) => record.text.replace(/\s+/gu, " ").length >= 180 && (!startPage || record.page >= startPage) && (!nextPage || record.page < nextPage));
  const sample = scoped[Math.floor(Math.random() * scoped.length)];
  if (!sample) return Response.json({ error: "目前主題沒有可供抽樣的真實頁面內容。" }, { status: 409 });
  const sourceText = sample.text.replace(/\s+/gu, " ").trim().slice(0, 1800);
  const payload = await openAIJson("/responses", {
    method: "POST",
    body: JSON.stringify({
      model: "gpt-5.6-luna",
      instructions: "你是教材真實演練出題員。只依提供的單頁教材原文，產生一個自然、具體、學生會在對話框詢問的行政法問題。問題不得提到頁碼、抽樣、測試或已知答案；不得抄出整段答案。anchorPhrase 必須是原文中逐字存在、4至18字且能辨識考點的核心短語，question 必須逐字包含 anchorPhrase，讓教材搜尋能以學生實際問法檢索。",
      input: `教材頁面原文：\n${sourceText}`,
      text: { format: { type: "json_schema", name: "pengli_random_book_test", strict: true, schema: {
        type: "object", additionalProperties: false,
        properties: {
          question: { type: "string", minLength: 12, maxLength: 120 },
          anchorPhrase: { type: "string", minLength: 4, maxLength: 18 },
        },
        required: ["question", "anchorPhrase"],
      } } },
      max_output_tokens: 280,
    }),
  }) as Record<string, unknown>;
  let generated: { question?: string; anchorPhrase?: string } = {};
  try { generated = JSON.parse(outputText(payload)) as typeof generated; } catch { /* 下方回報 */ }
  const question = String(generated.question ?? "").trim();
  const anchorPhrase = String(generated.anchorPhrase ?? "").trim();
  if (!question || !anchorPhrase || !sourceText.includes(anchorPhrase) || !question.includes(anchorPhrase)) {
    return Response.json({ error: "這次未能從抽樣頁形成可核對問題，請再按一次。" }, { status: 502 });
  }
  return Response.json({
    question,
    expectedPage: sample.page,
    expectedPageEnd: sample.pageEnd,
    anchorPhrase,
    sourceExcerpt: sourceText.slice(0, 420),
    sourceTitle: sample.title || book.title || book.fileName || "行政法考點演習書（二版）",
  }, { headers: { "Cache-Control": "no-store" } });
}
