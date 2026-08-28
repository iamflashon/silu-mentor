import { and, desc, eq, inArray, like, or } from "drizzle-orm";
import { getDb } from "../../../../../db";
import { documentAssignments, documentSectionMappings, documents } from "../../../../../db/schema";
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
const bookBodyStartPage = 23;

function isNavigationPage(text: string) {
  const normalized = text.replace(/\s+/gu, " ").trim();
  const dotLeaders = (normalized.match(/(?:\.{4,}|…{2,}|·{4,})/gu) ?? []).length;
  const compactPageRefs = (normalized.match(/\b\d{1,2}-\d{1,3}\b/gu) ?? []).length;
  const themeCount = themeTitles.filter((title) => normalized.includes(title)).length;
  return /目\s*錄|contents/iu.test(normalized.slice(0, 280)) || dotLeaders >= 2 || compactPageRefs >= 5 || themeCount >= 3;
}

function themeIndex(topic: string) {
  const normalized = topic.normalize("NFKC");
  return themeTitles.findIndex((title) => normalized.includes(title) || title.includes(normalized));
}

const anchorKeywords = ["行政法", "行政罰", "行政處分", "法律保留", "明確性", "裁量", "義務", "責任", "要件", "法律效果", "不利處分", "救濟", "訴願", "訴訟", "原則", "標準", "模式", "路徑"];

function isSubstantivePage(text: string) {
  const normalized = text.replace(/\s+/gu, " ").trim();
  const sentenceCount = (normalized.match(/[。；！？]/gu) ?? []).length;
  return !isNavigationPage(normalized) && normalized.length >= 220 && sentenceCount >= 1;
}

function exactAnchorCandidates(sourceText: string) {
  const candidates = new Set<string>();
  for (const match of sourceText.matchAll(/[「『]([^」』]{8,32})[」』]/gu)) candidates.add(match[1].trim());
  for (const clause of sourceText.split(/[。；！？]/u)) {
    const cleaned = clause.replace(/^[\s\d一二三四五六七八九十、.)（）]+/u, "").trim();
    if (cleaned.length >= 12) {
      if (cleaned.length <= 32) candidates.add(cleaned);
      for (const keyword of anchorKeywords) {
        const index = cleaned.indexOf(keyword);
        if (index < 0) continue;
        const start = Math.max(0, Math.min(index - 8, cleaned.length - 26));
        candidates.add(cleaned.slice(start, Math.min(cleaned.length, start + 26)));
      }
    }
  }
  for (const match of sourceText.matchAll(/[\p{Script=Han}]{4,}/gu)) {
    const run = match[0];
    if (run.length >= 10 && run.length <= 28) candidates.add(run);
    for (const keyword of anchorKeywords) {
      const index = run.indexOf(keyword);
      if (index < 0) continue;
      const start = Math.max(0, Math.min(index - 7, run.length - 22));
      candidates.add(run.slice(start, Math.min(run.length, start + 22)));
    }
  }
  return [...candidates]
    .map((value) => value.trim())
    .filter((value) => value.length >= 10 && value.length <= 32 && sourceText.includes(value) && !themeTitles.includes(value))
    .sort((left, right) => {
      const leftScore = anchorKeywords.filter((keyword) => left.includes(keyword)).length * 20 + Math.min(left.length, 24);
      const rightScore = anchorKeywords.filter((keyword) => right.includes(keyword)).length * 20 + Math.min(right.length, 24);
      return rightScore - leftScore;
    });
}

type TestQuestionKind = "case_facts" | "issue_prompt" | "explanation";

function sourceExcerptAround(text: string, anchor: string) {
  const index = text.indexOf(anchor);
  const start = Math.max(0, index - 150);
  return `${start > 0 ? "…" : ""}${text.slice(start, Math.min(text.length, start + 620))}${start + 620 < text.length ? "…" : ""}`;
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
  const selectedThemeIndex = themeIndex(requestedTopic);
  if (selectedThemeIndex < 0) return Response.json({ error: "目前無法確認正在學習的主題。" }, { status: 409 });
  const [mapped] = await db.select().from(documentSectionMappings).where(and(
    inArray(documentSectionMappings.documentId, books.map((item) => item.id)),
    eq(documentSectionMappings.sectionKey, `theme_${selectedThemeIndex + 1}`),
    eq(documentSectionMappings.verified, true),
  )).limit(1);
  if (!mapped || mapped.pdfStartPage <= 0 || mapped.pdfEndPage < mapped.pdfStartPage) return Response.json({ error: "目前主題尚未在後台完成「章節 ↔ PDF 頁段」核對，因此不執行隨機書頁測試。" }, { status: 409 });
  const book = books.find((item) => item.id === mapped.documentId) ?? books[0];
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

  const effectiveStartPage = Math.max(bookBodyStartPage, mapped.pdfStartPage);
  const scoped = records.filter((record) => record.page >= effectiveStartPage && record.page <= mapped.pdfEndPage && !isNavigationPage(record.text) && record.text.replace(/\s+/gu, " ").length >= 120);
  const substantive = scoped.filter((record) => isSubstantivePage(record.text));
  const pagePool = substantive.length ? substantive : scoped;
  const shuffled = [...pagePool].sort((left, right) => {
    const score = (text: string) => {
      const normalized = text.replace(/\s+/gu, " ");
      const reasoning = (normalized.match(/(?:係指|要件|判斷|原則|例外|因此|故|理由|應先|其次|是否|法律效果)/gu) ?? []).length;
      const weak = (normalized.match(/(?:版權頁|空白頁|本頁故意留白)/gu) ?? []).length;
      return reasoning * 3 - weak * 20 + Math.random() * 10;
    };
    return score(right.text) - score(left.text);
  });
  let chosen: { sample: (typeof pagePool)[number]; sourceText: string; question: string; answerAnchor: string; questionKind: TestQuestionKind } | null = null;
  for (const sample of shuffled.slice(0, Math.min(5, shuffled.length))) {
    const sourceText = sample.text.replace(/\s+/gu, " ").trim().slice(0, 3200);
    try {
      const payload = await openAIJson("/responses", {
        method: "POST",
        body: JSON.stringify({
          model: "gpt-5.6-luna",
          instructions: `你是具備臺灣行政法訓練的教材真實演練出題員。只能依提供的單頁教材原文出題，不得使用一般法律知識補足本頁沒有寫出的內容。

先判斷頁面性質：
1. case_facts：案例人物、函文、處分或事件事實。只能詢問本頁明載的具體事實、行為或文件。
2. issue_prompt：頁面主要列出待作答問題或爭點。只能詢問本頁要求分析哪個爭點，不得要求回答尚未出現的法律結論。
3. explanation：頁面已經出現規則、判準、理由或結論。只有這類頁面才能詢問概念、要件、層次或判斷方法。

usable 只有在本頁具有足以形成完整問題與答案的內容時才能為 true；若只有章節標題、頁尾、空白、殘句，或答案明顯要到其他頁才會出現，必須回傳 false，系統會自動改抽別頁。

usable=true 時，產生一個學生會自然詢問、而且完全能由本頁回答的專業問題。優先詢問法律爭點、判斷順序、規則與例外、理由、法律效果，或案例事實如何形成爭議；避免只問名詞抄寫或簡單是非題。案例題幹頁不得要求作出本頁尚未提供的最終法律結論。不得提到抽樣、測試或「依原文」。answerAnchor 必須是本頁連續逐字出現、8至50字、能直接回答問題的核心原句；不得只是章節標題，也不得把完整 answerAnchor 直接寫進問題。`,
          input: `教材單頁原文：\n${sourceText}`,
          text: { format: { type: "json_schema", name: "pengli_random_book_test", strict: true, schema: {
            type: "object", additionalProperties: false,
            properties: {
              usable: { type: "boolean" },
              questionKind: { type: "string", enum: ["case_facts", "issue_prompt", "explanation"] },
              question: { type: "string", minLength: 0, maxLength: 120 },
              answerAnchor: { type: "string", minLength: 0, maxLength: 50 },
            },
            required: ["usable", "questionKind", "question", "answerAnchor"],
          } } },
          max_output_tokens: 300,
        }),
      }) as Record<string, unknown>;
      const generated = JSON.parse(outputText(payload)) as { usable?: boolean; questionKind?: TestQuestionKind; question?: string; answerAnchor?: string };
      if (generated.usable !== true) continue;
      const candidate = String(generated.question ?? "").trim();
      const answerAnchor = String(generated.answerAnchor ?? "").replace(/\s+/gu, " ").trim();
      const questionKind = generated.questionKind;
      if (!questionKind || !["case_facts", "issue_prompt", "explanation"].includes(questionKind)) continue;
      if (!sourceText.includes(answerAnchor) || answerAnchor.length < 8 || answerAnchor.length > 50 || candidate.includes(answerAnchor)) continue;
      chosen = { sample, sourceText, question: candidate, answerAnchor, questionKind };
      break;
    } catch { /* 改抽同主題的另一個正文頁 */ }
  }
  if (!chosen) {
    const sample = shuffled[0];
    if (!sample) return Response.json({ error: "目前主題尚未建立可抽樣的頁數範圍。" }, { status: 409 });
    const sourceText = sample.text.replace(/\s+/gu, " ").trim().slice(0, 3200);
    const answerAnchor = exactAnchorCandidates(sourceText)[0] ?? (sourceText.match(/[\p{Script=Han}]{10,32}/gu) ?? [])[0];
    if (!answerAnchor) return Response.json({ error: "抽樣頁面暫時沒有可形成問題的正文。" }, { status: 409 });
    chosen = { sample, sourceText, answerAnchor, questionKind: "case_facts", question: "這一頁記載的具體事實或待判斷爭點是什麼？請先說明本頁確實寫出的內容。" };
  }
  const bookPageLabel = `${selectedThemeIndex + 1}-${chosen.sample.page - mapped.pdfStartPage + 1}`;
  return Response.json({
    question: `書內第 ${bookPageLabel} 頁，${chosen.question}`,
    questionKind: chosen.questionKind,
    bookPageLabel,
    expectedPage: chosen.sample.page,
    expectedPageEnd: chosen.sample.pageEnd,
    answerAnchor: chosen.answerAnchor,
    sourceExcerpt: sourceExcerptAround(chosen.sourceText, chosen.answerAnchor),
    sourceTitle: chosen.sample.title || book.title || book.fileName || "行政法考點演習書（二版）",
  }, { headers: { "Cache-Control": "no-store" } });
}
