import { and, desc, eq, inArray, like, or } from "drizzle-orm";
import { getDb } from "../../../../../db";
import { documentAssignments, documentSectionMappings, documents } from "../../../../../db/schema";
import { requireMember } from "../../../../../lib/member-auth";
import { detectPengliBodyRole, resolvePengliIssue } from "../../../../../lib/pengli-book-toc";

const themeTitles = ["行政法理論基礎與行政組織法", "行政處分", "行政契約與行政命令", "行政罰法", "行政執行法", "訴願法與行政訴訟法", "國家賠償法與損失補償", "新進實務見解整理"];
const verifiedThemePages = [[23, 84], [85, 172], [173, 233], [234, 302], [303, 332], [333, 420], [421, 456], [457, 495]] as const;
const bookBodyStartPage = 23;

function themeIndex(topic: string) {
  const normalized = topic.normalize("NFKC");
  return themeTitles.findIndex((title) => normalized.includes(title) || title.includes(normalized));
}

type TestQuestionKind = "case_facts" | "issue_prompt" | "explanation";

function answerAnchorFromPage(text: string) {
  const normalized = text.replace(/\s+/gu, " ").trim();
  const clauses = normalized.split(/(?<=[。；！？])/u).map((item) => item.trim()).filter((item) =>
    item.length >= 12
    && !/^(?:主題|考點|考點直擊站|考點破解|問題意識|學說見解|實務見解|擬答|概說)/u.test(item)
    && !/^\d+(?:-\d+)?$/u.test(item),
  );
  const concise = clauses.find((item) => item.length >= 18 && item.length <= 70);
  return (concise ?? clauses[0] ?? normalized).slice(0, 50).trim();
}

function sourceExcerptAround(text: string, anchor: string) {
  const index = text.indexOf(anchor);
  const start = Math.max(0, index - 150);
  return `${start > 0 ? "…" : ""}${text.slice(start, Math.min(text.length, start + 620))}${start + 620 < text.length ? "…" : ""}`;
}

export async function POST(request: Request) {
  const auth = await requireMember(request);
  if ("error" in auth) return auth.error;

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

  const requestBody = await request.json().catch(() => ({})) as { topic?: unknown; excludedPages?: unknown; excludedQuestions?: unknown };
  const requestedTopic = String(requestBody.topic ?? "").trim();
  const excludedPages = new Set((Array.isArray(requestBody.excludedPages) ? requestBody.excludedPages : []).map(Number).filter((page) => Number.isInteger(page) && page > 0).slice(-24));
  const excludedQuestions = new Set((Array.isArray(requestBody.excludedQuestions) ? requestBody.excludedQuestions : []).map(String).slice(-24));
  const selectedThemeIndex = themeIndex(requestedTopic);
  if (selectedThemeIndex < 0) return Response.json({ error: "目前無法確認正在學習的主題。" }, { status: 409 });
  const [storedMapping] = await db.select().from(documentSectionMappings).where(and(
    inArray(documentSectionMappings.documentId, books.map((item) => item.id)),
    eq(documentSectionMappings.sectionKey, `theme_${selectedThemeIndex + 1}`),
    eq(documentSectionMappings.verified, true),
  )).limit(1);
  const indexedBook = books.find((item) => /\.local-index\.jsonl$/iu.test(item.fileName));
  const [knownStartPage, knownEndPage] = verifiedThemePages[selectedThemeIndex];
  const mapped = storedMapping && storedMapping.pdfStartPage > 0 && storedMapping.pdfEndPage >= storedMapping.pdfStartPage
    ? storedMapping
    : indexedBook ? { documentId: indexedBook.id, pdfStartPage: knownStartPage, pdfEndPage: knownEndPage } : null;
  if (!mapped) return Response.json({ error: "目前找不到教材逐頁索引，暫時無法抽選書頁。" }, { status: 409 });
  const book = books.find((item) => item.id === mapped.documentId && /\.local-index\.jsonl$/iu.test(item.fileName)) ?? indexedBook ?? books[0];
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
  const completePool = records.filter((record) => record.page >= effectiveStartPage && record.page <= mapped.pdfEndPage && record.text.replace(/\s+/gu, " ").trim().length >= 8);
  const freshPool = completePool.filter((record) => !excludedPages.has(record.page));
  const pagePool = freshPool.length ? freshPool : completePool;
  if (!pagePool.length) return Response.json({ error: "目前主題頁段沒有可供說明的逐頁文字。" }, { status: 409 });
  const sample = pagePool[Math.floor(Math.random() * pagePool.length)];
  const sourceText = sample.text.replace(/\s+/gu, " ").trim().slice(0, 3200);
  const answerAnchor = answerAnchorFromPage(sourceText);
  const questionKind: TestQuestionKind = "explanation";
  const themeNumber = selectedThemeIndex + 1;
  const themePage = sample.page - mapped.pdfStartPage + 1;
  const bookPageLabel = `${themeNumber}-${themePage}`;
  const issue = resolvePengliIssue(themeNumber, themePage);
  const bodyRole = detectPengliBodyRole(sourceText);
  const pageDescription = issue
    ? `書內第 ${bookPageLabel} 頁屬於「${issue.title}」${bodyRole === "考點正文" ? "" : `的「${bodyRole}」`}`
    : `書內第 ${bookPageLabel} 頁`;
  const questionCandidates = [
    `老師，${pageDescription}在說什麼？請依這一頁簡單說明。`,
    `老師，請告訴我${pageDescription}的重點是什麼？`,
  ].filter((question) => !excludedQuestions.has(question));
  const question = questionCandidates[0] ?? `老師，請依書內第 ${bookPageLabel} 頁說明這一頁的內容。`;
  return Response.json({
    question,
    questionKind,
    documentId: book.id,
    bookPageLabel,
    issueTitle: issue?.title ?? "",
    bodyRole,
    expectedPage: sample.page,
    expectedPageEnd: sample.pageEnd,
    answerAnchor,
    sourceExcerpt: sourceExcerptAround(sourceText, answerAnchor),
    sourceTitle: sample.title || book.title || book.fileName || "行政法考點演習書（二版）",
  }, { headers: { "Cache-Control": "no-store" } });
}
