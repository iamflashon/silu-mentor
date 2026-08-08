import { and, asc, eq, inArray } from "drizzle-orm";
import { getDb } from "../../../../db";
import {
  appSettings,
  documents,
  learningResources,
  resourceSegments,
} from "../../../../db/schema";
import {
  storedDocumentAnalysis,
  storedDocumentStats,
} from "../../../../lib/document-analysis";
import { documentExtension, resolveDocumentPayload } from "../../../../lib/document-processing";
import { openAIJson } from "../../../../lib/openai";

const CHAPTER_TYPES = ["book_chapter", "chapter", "book_outline", "book_chapter_pending"] as const;
// Temporary rows are still real saved extraction results.  They remain marked
// pending for the admin workflow, but must be readable so an interrupted job
// never makes the existing catalogue look empty.
const PENDING_CHAPTER_TYPE = "book_chapter_pending";
const SOURCE_PAGE_TYPE = "book_source_page";
const SOURCE_PAGE_BATCH_SIZE = 24;
const SOURCE_TEXT_MIN_LENGTH = 40;
const SOURCE_TEXT_MAX_LENGTH = 120_000;
// D1 limits the number of bound parameters in a single statement. The chapter
// INSERT currently binds 15 values per row (not ten: Drizzle also binds the
// defaulted fields we set explicitly), so eight chapters would bind about 120
// parameters and fail before D1 can execute the statement. Four rows keeps the
// statement safely below the limit while avoiding one network round-trip per
// chapter.
const CHAPTER_INSERT_BATCH_SIZE = 4;

type ChapterPayload = {
  chapters?: Array<{
    title?: string;
    name?: string;
    label?: string;
    chapter_title?: string;
    section?: string;
    topic?: string;
    stem?: string;
    summary?: string;
    content?: string;
    text?: string;
    original_text?: string;
    page_start?: number | null;
    page_end?: number | null;
  }>;
};

type ProblemOutlinePayload = {
  topics?: Array<{
    section?: string;
    topic?: string;
  }>;
};

type StoredDocumentAnalysis = {
  chapters?: unknown[];
  questions?: unknown[];
};

// One topic per request keeps each file-search response comfortably below the
// model's tokens-per-minute ceiling. A larger batch can retrieve tens of
// thousands of tokens even though the calls themselves are sequential.
const PROBLEM_TOPIC_BATCH_SIZE = 1;
const PROBLEM_FILE_SEARCH_RESULTS = 16;
const MIN_COMPLETE_PROBLEM_QUESTIONS = 8;

type ChapterProgress = {
  state: "not_started" | "building" | "paused" | "failed" | "completed";
  phase?: "outline" | "questions" | "saving" | "paused" | "failed";
  completedTopics?: number;
  totalTopics?: number;
  foundQuestions?: number;
  currentTopic?: string;
  error?: string;
  topics?: Array<{ section: string; topic: string }>;
};

type ChapterSourceProgress = {
  failedSegmentIds?: number[];
  failures?: Array<{ segmentId: number; title: string; error: string }>;
};

type VectorSearchResult = {
  file_id?: string;
  filename?: string;
  score?: number;
  attributes?: Record<string, unknown>;
  content?: Array<{ type?: string; text?: string }>;
};

function chapterStatusKey(resourceId: number) {
  return `book_chapters_status:${resourceId}`;
}

function chapterSourceStatusKey(resourceId: number) {
  return `book_chapter_source_status:${resourceId}`;
}

function outputText(payload: Record<string, unknown>) {
  if (typeof payload.output_text === "string")
    return payload.output_text.trim();
  const output = Array.isArray(payload.output) ? payload.output : [];
  return output
    .flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const content = Array.isArray((item as { content?: unknown[] }).content)
        ? (item as { content: unknown[] }).content
        : [];
      return content.flatMap((part) =>
        part &&
        typeof part === "object" &&
        typeof (part as { text?: unknown }).text === "string"
          ? [(part as { text: string }).text]
          : [],
      );
    })
    .join("")
    .trim();
}

function parseChapterPayload(payload: Record<string, unknown>) {
  const raw = outputText(payload)
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  try {
    const parsed = JSON.parse(raw) as ChapterPayload;
    return (parsed.chapters ?? [])
      .filter((chapter) => String(chapter.title ?? "").trim())
      .slice(0, 80);
  } catch {
    return [] as ChapterPayload["chapters"];
  }
}

function parseProblemOutline(payload: Record<string, unknown>) {
  const raw = outputText(payload)
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  try {
    const parsed = JSON.parse(raw) as ProblemOutlinePayload;
    return (parsed.topics ?? [])
      .map((item) => ({
        section: String(item.section ?? "").trim(),
        topic: String(item.topic ?? "").trim(),
      }))
      .filter((item) => item.topic)
      .filter(
        (item, index, all) =>
          all.findIndex(
            (candidate) =>
              candidate.section === item.section && candidate.topic === item.topic,
          ) === index,
      )
      .slice(0, 36);
  } catch {
    return [] as Array<{ section: string; topic: string }>;
  }
}

function problemQuestionKey(chapter: NonNullable<ChapterPayload["chapters"]>[number]) {
  return `${String(chapter.section ?? "").trim()}|${String(chapter.topic ?? "").trim()}|${String(chapter.title ?? "").trim()}`;
}

function isProblemBook(resource: { title: string; description: string | null }) {
  return /解題|題庫|題型|案例演習|申論/.test(
    `${resource.title} ${resource.description ?? ""}`,
  );
}

function isCompleteProblemQuestion(chapter: {
  title?: string | null;
  text?: string | null;
  stem?: string | null;
}) {
  const title = String(chapter.title ?? "").trim();
  const stem = String(chapter.text ?? chapter.stem ?? "").trim();
  return /題型\s*\d+(?:\.\d+)+|第\s*\d+\s*題/.test(title) && stem.length >= 30;
}

function readStoredDocumentAnalysis(document: typeof documents.$inferSelect) {
  const parsed = storedDocumentAnalysis(document.processingResultJson || "{}");
  return parsed && (Array.isArray(parsed.questions) || Array.isArray(parsed.chapters))
    ? (parsed as StoredDocumentAnalysis)
    : null;
}

function storedCatalogueRows(
  resourceId: number,
  document: typeof documents.$inferSelect,
  mode: "questions" | "chapters" = "questions",
) {
  const analysis = readStoredDocumentAnalysis(document);
  const sourceRows = mode === "chapters"
    ? (Array.isArray(analysis?.chapters) ? analysis.chapters : [])
    : (Array.isArray(analysis?.questions) ? analysis.questions : []);
  return sourceRows
    .map((item, index) => {
      // Older document runs saved chapter candidates as plain strings, while
      // newer runs use heading/title/path objects. Accept both shapes so an
      // existing 33-chapter analysis is not incorrectly shown as empty.
      const row = typeof item === "string"
        ? { title: item }
        : item && typeof item === "object"
          ? item as Record<string, unknown>
          : {};
      const value = (keys: string[]) => {
        for (const key of keys) {
          const candidate = String(row[key] ?? "").trim();
          if (candidate) return candidate;
        }
        return "";
      };
      const path = value(["path", "section_path", "sectionPath", "outlinePath"]);
      const pathTitle = path.split(/[>/\\|]/).map((part) => part.trim()).filter(Boolean).at(-1) ?? "";
      const title = value([
        "title", "name", "label", "heading", "chapter_title", "chapterTitle",
        "displayName", "question_title", "questionTitle", "question_no", "questionNo", "number",
      ]) || pathTitle;
      if (!title) return null;
      const section = value(["section", "part", "section_path", "sectionPath", "path", "parent", "parentTitle"]);
      const topic = value(["chapter", "topic", "theme", "subject", "topicTitle"])
        || (mode === "chapters" ? "教材章節" : "其他題型");
      const text = value([
        "content", "text", "body", "original_text", "originalText", "source_text", "sourceText",
        "rawText", "stem", "question_text", "questionText", "question",
      ]);
      const summary = value(["summary", "abstract", "description"]);
      const pageStart = Number(row.page_start ?? row.pageStart ?? row.page_from ?? row.pageFrom);
      const pageEnd = Number(row.page_end ?? row.pageEnd ?? row.page_to ?? row.pageTo);
      return {
        id: -(index + 1),
        resourceId,
        segmentType: "book_outline",
        lessonLabel: `${section || (mode === "chapters" ? "教材章節" : "題型目錄")}｜${topic}`.slice(0, 160),
        title,
        pageStart: Number.isFinite(pageStart) && pageStart > 0 ? pageStart : null,
        pageEnd: Number.isFinite(pageEnd) && pageEnd > 0 ? pageEnd : null,
        startSeconds: null,
        endSeconds: null,
        sourceUrl: "",
        text,
        summary: summary || (text
          ? mode === "chapters" ? "已保存教材章節內容" : "已擷取完整題目"
          : "已保存教材目錄；完整內容尚未附在分析結果中"),
        importance: 0,
        recommended: false,
        reviewStatus: text ? "ai_reviewed" : "catalogue_only",
        sequence: index + 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
    })
    .filter((row): row is NonNullable<typeof row> => Boolean(row));
}

function storedRowsForResource(
  resourceId: number,
  document: typeof documents.$inferSelect,
  problemBook: boolean,
) {
  // Problem books save question-level entries; ordinary books save chapter-
  // level entries. Both are already real extraction results and must be
  // readable before a separate resource_segments index is created.
  const preferred = storedCatalogueRows(resourceId, document, problemBook ? "questions" : "chapters");
  if (preferred.length) return preferred;
  return problemBook
    ? storedCatalogueRows(resourceId, document, "chapters")
    : storedCatalogueRows(resourceId, document, "questions");
}

async function readChapterProgressRecord(resourceId: number) {
  const db = await getDb();
  const [setting] = await db
    .select()
    .from(appSettings)
    .where(eq(appSettings.key, chapterStatusKey(resourceId)))
    .limit(1);
  if (!setting) return { progress: { state: "not_started" } as ChapterProgress, updatedAt: null as Date | null };
  try {
    const parsed = JSON.parse(setting.value) as ChapterProgress;
    if (parsed && typeof parsed.state === "string") return { progress: parsed, updatedAt: setting.updatedAt };
  } catch {
    // Older versions stored only a plain status string.
  }
  const state = ["building", "paused", "failed", "completed"].includes(setting.value)
    ? setting.value as ChapterProgress["state"]
    : "not_started";
  return { progress: { state }, updatedAt: setting.updatedAt };
}

async function readChapterStatus(resourceId: number) {
  return (await readChapterProgressRecord(resourceId)).progress.state;
}

async function writeChapterProgress(resourceId: number, progress: ChapterProgress) {
  const db = await getDb();
  await db
    .insert(appSettings)
    .values({ key: chapterStatusKey(resourceId), value: JSON.stringify(progress), updatedAt: new Date() })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: { value: JSON.stringify(progress), updatedAt: new Date() },
    });
}

async function readChapterSourceProgress(resourceId: number): Promise<ChapterSourceProgress> {
  const db = await getDb();
  const [setting] = await db
    .select()
    .from(appSettings)
    .where(eq(appSettings.key, chapterSourceStatusKey(resourceId)))
    .limit(1);
  if (!setting) return {};
  try {
    const parsed = JSON.parse(setting.value) as ChapterSourceProgress;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

async function writeChapterSourceProgress(resourceId: number, progress: ChapterSourceProgress) {
  const db = await getDb();
  await db
    .insert(appSettings)
    .values({ key: chapterSourceStatusKey(resourceId), value: JSON.stringify(progress), updatedAt: new Date() })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: { value: JSON.stringify(progress), updatedAt: new Date() },
    });
}

function cleanSourceText(value: string) {
  return value
    .replace(/\u0000/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalizedHeading(value: string) {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("zh-Hant")
    // Some law-book PDFs expose list glyphs as private-use characters. They
    // are layout artefacts, not part of the heading, and otherwise prevent a
    // real chapter title from matching its extracted page text.
    .replace(/[\uE000-\uF8FF]/g, "")
    .replace(/[\s\p{P}\p{S}]+/gu, "")
    .trim();
}

function headingNeedles(value: string) {
  const normalized = normalizedHeading(value);
  const withoutListPrefix = normalized
    .replace(/^(?:[一二三四五六七八九十百]+|\d+)(?:、|．|\.)?/, "")
    .replace(/^[①②③④⑤⑥⑦⑧⑨⑩]+/, "");
  const withoutArticleRange = withoutListPrefix.replace(/（?第?\d+(?:之\d+)?(?:至|到|－|-)第?\d+(?:之\d+)?條）?$/u, "");
  return [normalized, withoutListPrefix, withoutArticleRange]
    .map((item) => item.trim())
    .filter((item, index, all) => item.length >= 2 && all.indexOf(item) === index);
}

function pageTextFromItems(items: unknown[]) {
  let output = "";
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const text = String((item as { str?: unknown }).str ?? "");
    if (!text) continue;
    output += text;
    output += (item as { hasEOL?: unknown }).hasEOL ? "\n" : " ";
  }
  return cleanSourceText(output);
}

async function readSourcePages(resourceId: number) {
  const db = await getDb();
  return db
    .select()
    .from(resourceSegments)
    .where(
      and(
        eq(resourceSegments.resourceId, resourceId),
        eq(resourceSegments.segmentType, SOURCE_PAGE_TYPE),
      ),
    )
    .orderBy(asc(resourceSegments.sequence));
}

async function extractPdfPageBatch(
  resourceId: number,
  document: typeof documents.$inferSelect,
) {
  const { env } = await import("cloudflare:workers");
  const object = await env.BUCKET?.get(document.storageKey);
  if (!object) throw new Error("找不到已保存的原始教材檔案");
  const originalBytes = await object.arrayBuffer();
  const source = resolveDocumentPayload(document.fileName, document.contentType, originalBytes);
  if (documentExtension(source.fileName) !== "pdf") return null;

  const existingPages = await readSourcePages(resourceId);
  const existingNumbers = new Set(
    existingPages.map((row) => Number(row.pageStart)).filter((value) => Number.isInteger(value) && value > 0),
  );
  const { getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(new Uint8Array(source.bytes));
  try {
    const totalPages = pdf.numPages;
    let firstMissing = 1;
    while (firstMissing <= totalPages && existingNumbers.has(firstMissing)) firstMissing += 1;
    if (firstMissing > totalPages) {
      return { totalPages, pagesDone: existingNumbers.size, extracted: 0 };
    }
    const pageNumbers: number[] = [];
    for (let page = firstMissing; page <= totalPages && pageNumbers.length < SOURCE_PAGE_BATCH_SIZE; page += 1) {
      if (!existingNumbers.has(page)) pageNumbers.push(page);
    }
    const rows: Array<typeof resourceSegments.$inferInsert> = [];
    for (const pageNumber of pageNumbers) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      const text = pageTextFromItems(content.items as unknown[]);
      page.cleanup();
      rows.push({
        resourceId,
        segmentType: SOURCE_PAGE_TYPE,
        lessonLabel: "原始教材頁面",
        title: `第 ${pageNumber} 頁`,
        pageStart: pageNumber,
        pageEnd: pageNumber,
        text,
        summary: text ? "已由原始 PDF 直接擷取" : "此頁沒有可擷取的文字層",
        reviewStatus: text ? "source" : "source_empty",
        sequence: pageNumber,
      });
    }
    const db = await getDb();
    for (let index = 0; index < rows.length; index += CHAPTER_INSERT_BATCH_SIZE) {
      await db.insert(resourceSegments).values(rows.slice(index, index + CHAPTER_INSERT_BATCH_SIZE));
    }
    return {
      totalPages,
      pagesDone: Math.min(totalPages, existingNumbers.size + rows.length),
      extracted: rows.length,
    };
  } finally {
    await pdf.cleanup();
  }
}

function locateChapterPage(
  pages: Array<typeof resourceSegments.$inferSelect>,
  title: string,
  preferredPage: number | null,
  minimumPage: number,
) {
  const needles = headingNeedles(title);
  if (!needles.length) return preferredPage && preferredPage >= minimumPage ? preferredPage : null;
  const matches = pages
    .filter((page) => Number(page.pageStart) >= minimumPage)
    .map((page) => {
      const lines = page.text.split(/\r?\n/).map(normalizedHeading).filter(Boolean);
      const pageText = normalizedHeading(page.text);
      let score = 0;
      for (const needle of needles) {
        if (lines.some((line) => line === needle)) score = Math.max(score, 100);
        if (needle.length >= 4 && lines.some((line) => line.startsWith(needle) || needle.startsWith(line))) score = Math.max(score, 80);
        if (needle.length >= 5 && pageText.includes(needle)) score = Math.max(score, 55);
      }
      return {
        page: Number(page.pageStart),
        score,
      };
    });
  const bestScore = Math.max(0, ...matches.map((match) => match.score));
  const candidates = matches.filter((match) => match.score === bestScore && match.score >= 55).map((match) => match.page);
  if (!candidates.length) return preferredPage && preferredPage >= minimumPage ? preferredPage : null;
  if (preferredPage && preferredPage >= minimumPage) {
    return candidates.reduce((best, page) => Math.abs(page - preferredPage) < Math.abs(best - preferredPage) ? page : best);
  }
  return candidates[0];
}

async function fillChaptersFromExtractedPages(resourceId: number) {
  const db = await getDb();
  const chapters = (await readChapters(resourceId)).filter((row) => row.segmentType !== PENDING_CHAPTER_TYPE);
  const pages = await readSourcePages(resourceId);
  if (!chapters.length || !pages.length) return { updated: 0, total: chapters.length };
  const pageByNumber = new Map(pages.map((page) => [Number(page.pageStart), page]));
  const totalPages = Math.max(...pages.map((page) => Number(page.pageStart) || 0));
  const starts: Array<number | null> = [];
  let minimumPage = 1;
  for (const chapter of chapters) {
    const preferred = chapter.pageStart && chapter.pageStart <= totalPages ? chapter.pageStart : null;
    const located = locateChapterPage(pages, chapter.title, preferred, minimumPage);
    starts.push(located);
    if (located) minimumPage = located;
  }

  let updated = 0;
  const locatedIds = new Set<number>();
  for (let index = 0; index < chapters.length; index += 1) {
    const chapter = chapters[index];
    const start = starts[index];
    if (!start) continue;
    const nextStart = starts.slice(index + 1).find((value): value is number => Boolean(value && value > start));
    const storedEnd = chapter.pageEnd && chapter.pageEnd >= start ? chapter.pageEnd : null;
    // Never let an unresolved next heading make one high-level "篇" consume
    // the rest of a several-hundred-page book. A stored end is accepted only
    // when it is a reasonably sized chapter; otherwise this row remains
    // unresolved and can be retried through the book-scoped index.
    const safeStoredEnd = storedEnd && storedEnd - start <= 80 ? storedEnd : null;
    const isLastChapter = index === chapters.length - 1;
    if (!nextStart && !safeStoredEnd && !isLastChapter) continue;
    const end = Math.min(totalPages, nextStart ? nextStart - 1 : safeStoredEnd ?? totalPages);
    const text = cleanSourceText(
      Array.from({ length: Math.max(0, end - start + 1) }, (_, offset) => pageByNumber.get(start + offset)?.text ?? "")
        .filter(Boolean)
        .join("\n\n"),
    ).slice(0, SOURCE_TEXT_MAX_LENGTH);
    if (text.length < SOURCE_TEXT_MIN_LENGTH) continue;
    const existingSpan = chapter.pageStart && chapter.pageEnd ? chapter.pageEnd - chapter.pageStart : 0;
    const existingLooksWrong = chapter.text.length >= SOURCE_TEXT_MAX_LENGTH - 100 || existingSpan > 80;
    if (chapter.text.trim().length >= SOURCE_TEXT_MIN_LENGTH && !existingLooksWrong) {
      locatedIds.add(chapter.id);
      continue;
    }
    await db
      .update(resourceSegments)
      .set({ text, pageStart: start, pageEnd: end, reviewStatus: "source" })
      .where(eq(resourceSegments.id, chapter.id));
    locatedIds.add(chapter.id);
    updated += 1;
  }
  return { updated, total: chapters.length, locatedIds: [...locatedIds] };
}

function exactSearchText(payload: Record<string, unknown>, fileId: string) {
  const data = Array.isArray(payload.data) ? payload.data as VectorSearchResult[] : [];
  const exact = data.filter((row) => row.file_id === fileId);
  if (!exact.length) return "";
  const bestScore = Math.max(...exact.map((row) => Number(row.score) || 0));
  const threshold = Math.max(0.08, bestScore * 0.55);
  const chunks = exact
    .filter((row) => (Number(row.score) || 0) >= threshold)
    .flatMap((row) => Array.isArray(row.content) ? row.content : [])
    .map((part) => String(part.text ?? "").trim())
    .filter(Boolean)
    .filter((text, index, all) => all.indexOf(text) === index);
  return cleanSourceText(chunks.join("\n\n")).slice(0, SOURCE_TEXT_MAX_LENGTH);
}

async function retrieveIndexedChapterSource(
  storeId: string,
  document: typeof documents.$inferSelect,
  target: typeof resourceSegments.$inferSelect,
) {
  const query = [target.lessonLabel, target.title, target.pageStart ? `第 ${target.pageStart} 頁` : "", "章節原文"]
    .filter(Boolean)
    .join(" ");
  const base = { query, max_num_results: 20, rewrite_query: true };
  const filtered = await openAIJson(`/vector_stores/${storeId}/search`, {
    method: "POST",
    body: JSON.stringify({
      ...base,
      filters: { type: "eq", key: "source_file", value: document.fileName },
    }),
  });
  const filteredText = exactSearchText(filtered, document.openaiFileId ?? "");
  if (filteredText.length >= SOURCE_TEXT_MIN_LENGTH) return filteredText;

  // Files indexed before attributes were introduced will not match the
  // metadata filter. Search the same store once more, but still accept only
  // chunks whose file_id exactly matches this document.
  const fallback = await openAIJson(`/vector_stores/${storeId}/search`, {
    method: "POST",
    body: JSON.stringify(base),
  });
  return exactSearchText(fallback, document.openaiFileId ?? "");
}

async function retrieveIndexedProblemSource(
  storeId: string,
  document: typeof documents.$inferSelect,
  target: typeof resourceSegments.$inferSelect,
) {
  const query = [
    target.lessonLabel,
    target.title,
    target.pageStart ? `第 ${target.pageStart} 頁` : "",
    "完整題目 解題解析 擬答 爭點 規範 涵攝 結論",
  ].filter(Boolean).join(" ");
  const base = { query, max_num_results: 30, rewrite_query: true };
  const filtered = await openAIJson(`/vector_stores/${storeId}/search`, {
    method: "POST",
    body: JSON.stringify({
      ...base,
      filters: { type: "eq", key: "source_file", value: document.fileName },
    }),
  });
  const filteredText = exactSearchText(filtered, document.openaiFileId ?? "");
  if (filteredText.length >= SOURCE_TEXT_MIN_LENGTH) return filteredText;
  const fallback = await openAIJson(`/vector_stores/${storeId}/search`, {
    method: "POST",
    body: JSON.stringify(base),
  });
  return exactSearchText(fallback, document.openaiFileId ?? "");
}

function progressForResponse(progress: ChapterProgress, updatedAt: Date | null) {
  const stale = progress.state === "building" && updatedAt
    ? Date.now() - updatedAt.getTime() > 120_000
    : false;
  return {
    ...progress,
    stale,
    lastUpdatedAt: updatedAt?.toISOString() ?? null,
    ...(stale ? { state: "paused", phase: "paused", error: "上一輪解析可能已中斷；原資料仍保留，請重新執行解析。" } : {}),
  };
}

async function readChapters(resourceId: number) {
  const db = await getDb();
  return db
    .select()
    .from(resourceSegments)
    .where(
      and(
        eq(resourceSegments.resourceId, resourceId),
        inArray(resourceSegments.segmentType, [...CHAPTER_TYPES]),
      ),
    )
    .orderBy(asc(resourceSegments.sequence));
}

async function readPendingChapters(resourceId: number) {
  const db = await getDb();
  return db
    .select()
    .from(resourceSegments)
    .where(
      and(
        eq(resourceSegments.resourceId, resourceId),
        eq(resourceSegments.segmentType, PENDING_CHAPTER_TYPE),
      ),
    )
    .orderBy(asc(resourceSegments.sequence));
}

async function materializeStoredChapters(
  resourceId: number,
  document: typeof documents.$inferSelect,
) {
  const db = await getDb();
  const existing = await readChapters(resourceId);
  if (existing.length) return existing;

  const storedRows = storedRowsForResource(resourceId, document, false);
  if (!storedRows.length) return [];

  const rows = storedRows.map((row, index) => ({
    resourceId,
    segmentType: "book_chapter",
    lessonLabel: row.lessonLabel,
    title: row.title,
    pageStart: row.pageStart,
    pageEnd: row.pageEnd,
    text: row.text,
    summary: row.summary,
    reviewStatus: row.text ? "source" : "catalogue_only",
    sequence: index + 1,
  }));
  for (let index = 0; index < rows.length; index += CHAPTER_INSERT_BATCH_SIZE) {
    await db.insert(resourceSegments).values(rows.slice(index, index + CHAPTER_INSERT_BATCH_SIZE));
  }
  return readChapters(resourceId);
}

/**
 * Read-only endpoint for students.
 *
 * Important: this endpoint must never send a PDF to an AI model. Chapter
 * extraction is an explicit, one-time admin action handled by POST below.
 */
export async function GET(request: Request) {
  try {
    const resourceId = Number(
      new URL(request.url).searchParams.get("resourceId"),
    );
    if (!Number.isInteger(resourceId) || resourceId < 1)
      return Response.json({ error: "缺少書籍編號" }, { status: 400 });

    const db = await getDb();
    const [resource] = await db
      .select()
      .from(learningResources)
      .where(eq(learningResources.id, resourceId))
      .limit(1);
    if (!resource || resource.resourceType !== "book")
      return Response.json({ error: "找不到書籍" }, { status: 404 });

    const chapters = await readChapters(resourceId);
    const progressRecord = await readChapterProgressRecord(resourceId);
    const progress = progressForResponse(progressRecord.progress, progressRecord.updatedAt);
    if (new URL(request.url).searchParams.get("progress") === "1") {
      const [document] = resource.documentId
        ? await db
            .select()
            .from(documents)
            .where(eq(documents.id, resource.documentId))
            .limit(1)
        : [];
      const stored = document
        ? storedDocumentStats(
            document.processingResultJson,
            document.chapterCount,
            document.questionCount,
          )
        : { chapterCount: 0, topicCount: 0, questionCount: 0 };
      const storedAnalysis = document
        ? storedDocumentAnalysis(document.processingResultJson)
        : null;
      const hasCompletedStoredAnalysis = Boolean(
        document &&
          document.status === "completed" &&
          (stored.chapterCount > 0 || stored.questionCount > 0) &&
          (Array.isArray(storedAnalysis?.questions) ||
            Array.isArray(storedAnalysis?.chapters)),
      );
      const effectiveProgress = hasCompletedStoredAnalysis
        ? {
            ...progress,
            state: "completed" as const,
            phase: "saving" as const,
            completedTopics: stored.topicCount || stored.chapterCount,
            totalTopics: stored.topicCount || stored.chapterCount,
            foundQuestions: stored.questionCount,
            currentTopic: "",
            error: undefined,
          }
        : progress;
      return Response.json({
        resourceId,
        status: effectiveProgress.state,
        progress: effectiveProgress,
      });
    }
    const status = progress.state;
    const problemBook = isProblemBook(resource);
    const usableChapters = problemBook
      ? chapters.filter(isCompleteProblemQuestion)
      : chapters;
    // The catalogue is useful before every stem has been recovered.  Returning
    // an empty array here made the real saved outline disappear whenever a
    // resumable extraction was interrupted.  Keep the catalogue visible and
    // let the UI distinguish complete questions from catalogue-only rows.
    if (problemBook && chapters.length) {
      const [document] = resource.documentId
        ? await db
            .select()
            .from(documents)
            .where(eq(documents.id, resource.documentId))
            .limit(1)
        : [];
      const storedCatalogue = document
        ? storedRowsForResource(resourceId, document, problemBook)
        : [];
      if (storedCatalogue.length) {
        return Response.json({
          chapters: storedCatalogue,
          generated: false,
          ready: true,
          status: "catalogue",
          incompleteCount: storedCatalogue.filter((item) => !item.text).length,
          progress,
          message: "已顯示教材處理時保存的真實題型目錄；完整題文整理完成後會自動替換。",
        });
      }
      return Response.json({
        chapters: chapters.map((chapter) => ({
          ...chapter,
          completeQuestion: isCompleteProblemQuestion(chapter),
        })),
        generated: false,
        ready: usableChapters.length >= MIN_COMPLETE_PROBLEM_QUESTIONS,
        status: usableChapters.length >= MIN_COMPLETE_PROBLEM_QUESTIONS
          ? "completed"
          : "partial",
        catalogueCount: chapters.length,
        completeQuestionCount: usableChapters.length,
        progress,
        message: usableChapters.length >= MIN_COMPLETE_PROBLEM_QUESTIONS
          ? undefined
          : `已先顯示 ${chapters.length} 筆真實目錄；其中 ${usableChapters.length} 題已具備完整題文，剩餘部分會由後台接續整理。`,
      });
    }

    // Once ordinary-book chapters have been materialized, they are the
    // canonical rows that enrichment updates. Returning the older virtual
    // catalogue here hid freshly saved source text behind negative-id rows.
    if (!problemBook && chapters.length) {
      const incompleteCount = chapters.filter((chapter) => chapter.text.trim().length < SOURCE_TEXT_MIN_LENGTH).length;
      const sourceProgress = await readChapterSourceProgress(resourceId);
      return Response.json({
        chapters,
        generated: false,
        ready: true,
        status: incompleteCount ? "partial" : "completed",
        incompleteCount,
        sourceFailures: sourceProgress.failures ?? [],
        progress,
        message: incompleteCount
          ? `已載入 ${chapters.length} 章；其中 ${incompleteCount} 章仍待補齊原文。`
          : `已載入 ${chapters.length} 章及已保存的教材原文。`,
      });
    }

    if (!resource.documentId) {
      return Response.json({
        chapters: [],
        generated: false,
        ready: false,
        status,
        progress,
        message: "這本書尚未綁定後台教材。",
      });
    }
    const [document] = await db
      .select()
      .from(documents)
      .where(eq(documents.id, resource.documentId))
      .limit(1);
    if (document) {
      const storedCatalogue = storedRowsForResource(resourceId, document, problemBook);
      if (storedCatalogue.length) {
        return Response.json({
          chapters: storedCatalogue,
          generated: false,
          ready: true,
          status: "catalogue",
          incompleteCount: storedCatalogue.filter((item) => !item.text).length,
          progress,
          message: problemBook
            ? "已顯示教材處理時保存的真實題型目錄；完整題文整理完成後會自動替換。"
            : "已直接讀取教材分析時保存的真實章節；可先檢視內容與頁碼，不需重新上傳或重新拆解。",
        });
      }
    }
    if (!document?.openaiFileId) {
      return Response.json({
        chapters: [],
        generated: false,
        ready: false,
        status,
        progress,
        message: "這本書尚未完成教材索引。",
      });
    }
    if (document.status !== "completed") {
      return Response.json(
        {
          chapters: [],
          generated: false,
          ready: false,
          status,
          progress,
          documentStatus: document.status,
          message:
            document.status === "failed"
              ? document.indexError || "教材索引失敗，請到後台重新建立索引。"
              : "教材正在建立索引，完成後請再讀取章節。",
        },
        { status: 202 },
      );
    }
    if (status === "building") {
      return Response.json(
        {
          chapters: [],
          generated: false,
          ready: false,
          status,
          progress,
          message: "後台正在建立章節索引，完成後即可讀取。",
        },
        { status: 202 },
      );
    }
    if (status === "failed") {
      return Response.json({
        chapters: [],
        generated: false,
        ready: true,
        status,
        progress,
        message:
          "章節索引曾建立失敗；請由管理後台明確按下「建立章節索引」再試一次。",
      });
    }
    return Response.json({
      chapters: [],
      generated: false,
      ready: true,
      status: "not_started",
      message:
        "教材已完成索引，但章節目錄尚未建立；請由管理後台建立一次章節索引。",
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message.slice(0, 240)
        : "教材章節暫時無法讀取，請稍後再試。";
    return Response.json(
      { chapters: [], generated: false, ready: false, error: message },
      { status: 503 },
    );
  }
}

/**
 * Explicit one-time chapter extraction for the admin.
 * It searches the already indexed vector store for the book's table of
 * contents. It deliberately does not use input_file, so the whole PDF is
 * never sent again and a normal page refresh cannot create another billable
 * extraction request.
 */
export async function POST(request: Request) {
  let resourceId = 0;
  let sourceBatchRequested = false;
  try {
    const body = (await request.json()) as {
      resourceId?: number;
      rebuild?: boolean;
      restart?: boolean;
      materialize?: boolean;
      enrich?: boolean;
      sourceBatch?: boolean;
      restartSourceFailures?: boolean;
      segmentId?: number;
    };
    sourceBatchRequested = body.sourceBatch === true;
    resourceId = Number(body.resourceId);
    if (!Number.isInteger(resourceId) || resourceId < 1)
      return Response.json({ error: "缺少書籍編號" }, { status: 400 });

    const db = await getDb();
    const [resource] = await db
      .select()
      .from(learningResources)
      .where(eq(learningResources.id, resourceId))
      .limit(1);
    if (!resource || resource.resourceType !== "book")
      return Response.json({ error: "找不到書籍" }, { status: 404 });

    const progressRecord = await readChapterProgressRecord(resourceId);
    let activeProgress = progressRecord.progress;
    const problemBook = isProblemBook(resource);
    const existing = await readChapters(resourceId);
    const pendingExisting = problemBook ? await readPendingChapters(resourceId) : [];
    const validExisting = problemBook
      ? existing.filter(isCompleteProblemQuestion)
      : existing;
    // `rebuild` used to be sent by the old admin button and caused a complete
    // saved queue to be deleted and started again.  A normal retry is always a
    // resume; only the explicit, currently-unused `restart` flag may reset a
    // queue.
    const explicitRestart = body.restart === true;
    if (body.sourceBatch === true) {
      if (!resource.documentId)
        return Response.json({ error: "這本書尚未綁定後台教材。" }, { status: 400 });
      const [document] = await db
        .select()
        .from(documents)
        .where(eq(documents.id, resource.documentId))
        .limit(1);
      if (!document)
        return Response.json({ error: "找不到已綁定的教材文件。" }, { status: 404 });
      if (document.status !== "completed")
        return Response.json({ error: "教材尚未完成全文索引，完成後才能補齊章節原文。" }, { status: 409 });

      if (problemBook) {
        const chapters = await readChapters(resourceId);
        if (!chapters.length)
          return Response.json({ error: "尚未建立題型目錄；請先整理題型與完整題目。" }, { status: 409 });
        if (!document.openaiFileId)
          return Response.json({ error: "這份解題書尚未完成可用的全文／向量索引。" }, { status: 409 });
        const [setting] = await db.select().from(appSettings)
          .where(eq(appSettings.key, "openai_vector_store_id")).limit(1);
        if (!setting?.value)
          return Response.json({ error: "教材向量索引尚未就緒。" }, { status: 409 });

        const readyRows = chapters.filter((chapter) => /^(source|source_index)$/.test(chapter.reviewStatus ?? ""));
        const target = chapters.find((chapter) => !/^(source|source_index)$/.test(chapter.reviewStatus ?? ""));
        if (!target) {
          await writeChapterSourceProgress(resourceId, {});
          return Response.json({
            status: "completed", phase: "completed", chaptersReady: readyRows.length,
            chaptersTotal: chapters.length, failedCount: 0,
            message: `已補齊 ${readyRows.length} 題的題目、解析與擬答原文。`,
          });
        }
        try {
          const content = await retrieveIndexedProblemSource(setting.value, document, target);
          if (content.length < SOURCE_TEXT_MIN_LENGTH)
            throw new Error("限定這一本解題書後，仍未找到足夠可核對的題目與解析全文");
          await db.update(resourceSegments).set({ text: content, reviewStatus: "source_index" })
            .where(eq(resourceSegments.id, target.id));
          const completed = readyRows.length + 1;
          return Response.json({
            status: completed === chapters.length ? "completed" : "searching",
            phase: "index", chaptersReady: completed, chaptersTotal: chapters.length,
            failedCount: 0, currentTitle: target.title,
            message: completed === chapters.length
              ? `已補齊 ${completed} 題的題目、解析與擬答原文。`
              : `正在逐題補抓題目與解析全文：${completed}／${chapters.length}`,
          });
        } catch (error) {
          const message = error instanceof Error ? error.message.slice(0, 160) : "題目與解析原文未命中";
          if (/較忙|限流|rate.?limit|429|try again/i.test(message)) {
            return Response.json({ status: "paused", phase: "index", chaptersReady: readyRows.length,
              chaptersTotal: chapters.length, currentTitle: target.title,
              message: "全文索引目前較忙；進度已保存，稍後會從這一題接續。" }, { status: 202 });
          }
          return Response.json({ error: `「${target.title}」補抓失敗：${message}` }, { status: 422 });
        }
      }

      let chapters = await materializeStoredChapters(resourceId, document);
      if (!chapters.length)
        return Response.json({ error: "找不到已保存的真實章節目錄；請先建立章節索引。" }, { status: 409 });

      let sourceProgress = body.restartSourceFailures
        ? {} as ChapterSourceProgress
        : await readChapterSourceProgress(resourceId);
      if (body.restartSourceFailures) await writeChapterSourceProgress(resourceId, sourceProgress);

      const pageBatch = await extractPdfPageBatch(resourceId, document);
      if (pageBatch && pageBatch.pagesDone < pageBatch.totalPages) {
        const ready = chapters.filter((chapter) => chapter.text.trim().length >= SOURCE_TEXT_MIN_LENGTH).length;
        return Response.json({
          status: "extracting",
          phase: "pages",
          pagesDone: pageBatch.pagesDone,
          totalPages: pageBatch.totalPages,
          chaptersReady: ready,
          chaptersTotal: chapters.length,
          failedCount: sourceProgress.failures?.length ?? 0,
          message: `正在直接讀取原始 PDF：${pageBatch.pagesDone}／${pageBatch.totalPages} 頁`,
        });
      }

      if (pageBatch) await fillChaptersFromExtractedPages(resourceId);
      chapters = await readChapters(resourceId);
      let ready = chapters.filter((chapter) => chapter.text.trim().length >= SOURCE_TEXT_MIN_LENGTH).length;
      const readyIds = new Set(
        chapters
          .filter((chapter) => chapter.text.trim().length >= SOURCE_TEXT_MIN_LENGTH)
          .map((chapter) => chapter.id),
      );
      if ((sourceProgress.failedSegmentIds ?? []).some((id) => readyIds.has(id))) {
        sourceProgress = {
          failedSegmentIds: (sourceProgress.failedSegmentIds ?? []).filter((id) => !readyIds.has(id)),
          failures: (sourceProgress.failures ?? []).filter((item) => !readyIds.has(item.segmentId)),
        };
        await writeChapterSourceProgress(resourceId, sourceProgress);
      }
      if (ready === chapters.length) {
        await writeChapterSourceProgress(resourceId, {});
        return Response.json({
          status: "completed",
          phase: "completed",
          pagesDone: pageBatch?.pagesDone ?? 0,
          totalPages: pageBatch?.totalPages ?? document.pageCount ?? 0,
          chaptersReady: ready,
          chaptersTotal: chapters.length,
          failedCount: 0,
          message: `已從原始教材補齊 ${ready} 章原文。`,
        });
      }

      const failedIds = new Set(sourceProgress.failedSegmentIds ?? []);
      const missing = chapters.filter((chapter) => chapter.text.trim().length < SOURCE_TEXT_MIN_LENGTH);
      const target = missing.find((chapter) => !failedIds.has(chapter.id));
      if (!target) {
        return Response.json({
          status: "partial",
          phase: "completed",
          pagesDone: pageBatch?.pagesDone ?? 0,
          totalPages: pageBatch?.totalPages ?? document.pageCount ?? 0,
          chaptersReady: ready,
          chaptersTotal: chapters.length,
          failedCount: sourceProgress.failures?.length ?? missing.length,
          failures: sourceProgress.failures ?? [],
          message: `已補齊 ${ready}／${chapters.length} 章；其餘章節在原始 PDF 與限定檔案索引中仍未找到足夠文字。`,
        });
      }

      if (!document.openaiFileId)
        return Response.json({ error: "原始 PDF 文字層不足，且這份教材尚未完成可用的向量索引。" }, { status: 409 });
      const [setting] = await db
        .select()
        .from(appSettings)
        .where(eq(appSettings.key, "openai_vector_store_id"))
        .limit(1);
      if (!setting?.value)
        return Response.json({ error: "教材向量索引尚未就緒。" }, { status: 409 });

      try {
        const content = await retrieveIndexedChapterSource(setting.value, document, target);
        if (content.length < SOURCE_TEXT_MIN_LENGTH) throw new Error("限定這一本教材後，仍未找到足夠可核對的原文片段");
        await db
          .update(resourceSegments)
          .set({ text: content, reviewStatus: "source_index" })
          .where(eq(resourceSegments.id, target.id));
        ready += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message.slice(0, 160) : "原文索引未命中";
        if (/較忙|限流|rate.?limit|429|try again/i.test(message)) {
          return Response.json({
            status: "paused",
            phase: "index",
            chaptersReady: ready,
            chaptersTotal: chapters.length,
            failedCount: sourceProgress.failures?.length ?? 0,
            currentTitle: target.title,
            message: "原文索引目前較忙；已保存頁面與章節進度，稍後會從這一章接續。",
          }, { status: 202 });
        }
        const failures = [
          ...(sourceProgress.failures ?? []).filter((item) => item.segmentId !== target.id),
          { segmentId: target.id, title: target.title, error: message },
        ];
        sourceProgress = {
          failedSegmentIds: [...failedIds, target.id],
          failures,
        };
        await writeChapterSourceProgress(resourceId, sourceProgress);
      }

      const remaining = chapters.length - ready - (sourceProgress.failedSegmentIds?.length ?? 0);
      return Response.json({
        status: remaining > 0 ? "searching" : ready === chapters.length ? "completed" : "partial",
        phase: "index",
        pagesDone: pageBatch?.pagesDone ?? 0,
        totalPages: pageBatch?.totalPages ?? document.pageCount ?? 0,
        chaptersReady: ready,
        chaptersTotal: chapters.length,
        failedCount: sourceProgress.failures?.length ?? 0,
        failures: sourceProgress.failures ?? [],
        currentTitle: target.title,
        message: remaining > 0
          ? `正在從限定教材索引補回剩餘章節：${ready}／${chapters.length}`
          : ready === chapters.length
            ? `已補齊 ${ready} 章原文。`
            : `已補齊 ${ready}／${chapters.length} 章；${sourceProgress.failures?.length ?? 0} 章未命中。`,
      });
    }
    if (body.materialize === true) {
      if (problemBook)
        return Response.json({ error: "解題書請使用「整理題型與完整題目」，不使用章節原文補齊流程。" }, { status: 400 });
      if (!resource.documentId)
        return Response.json({ error: "這本書尚未綁定後台教材。" }, { status: 400 });
      const [document] = await db
        .select()
        .from(documents)
        .where(eq(documents.id, resource.documentId))
        .limit(1);
      if (!document)
        return Response.json({ error: "找不到已綁定的教材文件。" }, { status: 404 });
      const chapters = await materializeStoredChapters(resourceId, document);
      return Response.json({
        status: chapters.length ? "completed" : "not_started",
        materialized: chapters.length,
        chapters,
      });
    }
    if (body.enrich === true) {
      if (problemBook)
        return Response.json({ error: "解題書請使用「整理題型與完整題目」，不使用章節原文補齊流程。" }, { status: 400 });
      const segmentId = Number(body.segmentId);
      if (!Number.isInteger(segmentId) || segmentId === 0)
        return Response.json({ error: "缺少要補齊的章節編號" }, { status: 400 });
      if (!resource.documentId)
        return Response.json({ error: "這本書尚未綁定後台教材。" }, { status: 400 });
      const [document] = await db
        .select()
        .from(documents)
        .where(eq(documents.id, resource.documentId))
        .limit(1);
      if (!document?.openaiFileId || document.status !== "completed")
        return Response.json({ error: "PDF 尚未完成教材索引，完成後才能補齊章節原文。" }, { status: 409 });
      const [setting] = await db
        .select()
        .from(appSettings)
        .where(eq(appSettings.key, "openai_vector_store_id"))
        .limit(1);
      if (!setting?.value)
        return Response.json({ error: "教材向量索引尚未就緒。" }, { status: 409 });

      const storedRows = storedRowsForResource(resourceId, document, false);
      const target = segmentId > 0
        ? existing.find((row) => row.id === segmentId) ?? null
        : storedRows.find((row) => row.id === segmentId) ?? null;
      if (!target)
        return Response.json({ error: "找不到要補齊的章節；請先建立章節索引。" }, { status: 404 });
      if (target.text && target.text.trim().length >= 40) {
        return Response.json({ status: "completed", segmentId, textLength: target.text.trim().length, reused: true });
      }

      const content = await retrieveIndexedChapterSource(setting.value, document, target);
      if (content.length < 40)
        return Response.json({ error: `「${target.title}」目前仍找不到足夠可核對的原文；請確認檔案已完成全文索引。` }, { status: 422 });

      if (segmentId > 0) {
        await db.update(resourceSegments)
          .set({ text: content, reviewStatus: "source_index" })
          .where(eq(resourceSegments.id, segmentId));
      } else {
        const parsedDocument = JSON.parse(document.processingResultJson || "{}") as Record<string, unknown>;
        const chapters = Array.isArray(parsedDocument.chapters)
          ? [...parsedDocument.chapters] as Array<Record<string, unknown>>
          : [];
        const chapterIndex = Math.abs(segmentId) - 1;
        if (chapterIndex < 0 || chapterIndex >= chapters.length)
          return Response.json({ error: "找不到教材分析中的對應章節。" }, { status: 404 });
        chapters[chapterIndex] = { ...chapters[chapterIndex], content };
        await db.update(documents)
          .set({ processingResultJson: JSON.stringify({ ...parsedDocument, chapters }) })
          .where(eq(documents.id, document.id));
      }
      return Response.json({ status: "completed", segmentId, textLength: content.length, reused: false });
    }
    if (
      validExisting.length &&
      !pendingExisting.length &&
      !explicitRestart &&
      (!problemBook ||
        activeProgress.state === "completed" ||
        !activeProgress.totalTopics ||
        (activeProgress.completedTopics ?? 0) >= activeProgress.totalTopics)
    )
      return Response.json({
        chapters: validExisting,
        generated: false,
        reused: true,
        status: "completed",
        progress: progressForResponse(activeProgress, progressRecord.updatedAt),
      });

    if (!resource.documentId)
      return Response.json(
        { error: "這本書尚未綁定後台教材。" },
        { status: 400 },
      );
    const [document] = await db
      .select()
      .from(documents)
      .where(eq(documents.id, resource.documentId))
      .limit(1);
    if (!document?.openaiFileId)
      return Response.json(
        { error: "這本書尚未完成教材索引，請先完成 PDF 索引。" },
        { status: 409 },
      );
    if (document.status !== "completed")
      return Response.json(
        {
          error: "PDF 尚未完成教材索引，完成後才能建立章節。",
          documentStatus: document.status,
        },
        { status: 409 },
      );

    const [setting] = await db
      .select()
      .from(appSettings)
      .where(eq(appSettings.key, "openai_vector_store_id"))
      .limit(1);
    if (!setting?.value)
      return Response.json(
        { error: "教材向量索引尚未就緒。" },
        { status: 409 },
      );

    // Problem-book extraction is a resumable queue. Each request performs at
    // most one topic, so a timeout or rate limit cannot discard the topics
    // already completed. A request with an existing checkpoint continues it.
    let topics = problemBook ? activeProgress.topics : undefined;
    if (problemBook && (!topics?.length || explicitRestart)) {
      await writeChapterProgress(resourceId, {
        state: "building", phase: "outline", completedTopics: 0,
        totalTopics: 0, foundQuestions: pendingExisting.length,
      });
      activeProgress = { state: "building", phase: "outline", completedTopics: 0, totalTopics: 0, foundQuestions: pendingExisting.length };
      topics = undefined;
    }
    const extractionModel =
      process.env.OPENAI_EXTRACTION_MODEL ||
      process.env.OPENAI_MODEL ||
      "gpt-5.6-luna";
    const problemQuestionSchema = {
      type: "object",
      additionalProperties: false,
      properties: {
        chapters: {
          type: "array",
          maxItems: 80,
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              title: { type: "string" },
              section: { type: "string" },
              topic: { type: "string" },
              stem: { type: "string" },
              summary: { type: "string" },
              content: { type: "string" },
              page_start: { type: ["integer", "null"] },
              page_end: { type: ["integer", "null"] },
            },
            required: ["title", "section", "topic", "stem", "summary", "content", "page_start", "page_end"],
          },
        },
      },
      required: ["chapters"],
    } as const;

    let parsed: NonNullable<ChapterPayload["chapters"]> = [];
    if (problemBook) {
      // A single whole-book semantic search usually returns only the few most
      // similar chunks. First recover the real topic catalogue, then issue
      // targeted searches in small topic batches so later parts of the book
      // are not silently omitted.
      if (!topics?.length) {
        const outlinePayload = await openAIJson("/responses", {
          method: "POST",
          body: JSON.stringify({
            model: extractionModel,
            instructions: "你是台灣司律解題書目錄核對員。使用 file_search，只抄錄原書目錄中明確存在的『部分』與『主題』；不要回傳題目、不要改寫名稱、不要自行補項目。保留原順序。",
            input: `請搜尋《${resource.title}》（原始檔名：${document.fileName}）的目錄，列出全部部分與主題。`,
            tools: [{ type: "file_search", vector_store_ids: [setting.value], max_num_results: 20 }],
            text: { format: { type: "json_schema", name: "problem_book_outline", strict: true, schema: { type: "object", additionalProperties: false, properties: { topics: { type: "array", maxItems: 36, items: { type: "object", additionalProperties: false, properties: { section: { type: "string" }, topic: { type: "string" } }, required: ["section", "topic"] } } }, required: ["topics"] } } },
          }),
        });
        topics = parseProblemOutline(outlinePayload);
        if (!topics.length) throw new Error("教材目錄未辨識到可處理的主題");
        await writeChapterProgress(resourceId, {
          state: "building", phase: "questions", completedTopics: 0,
          totalTopics: topics.length, foundQuestions: 0, topics,
        });
        activeProgress = { state: "building", phase: "questions", completedTopics: 0, totalTopics: topics.length, foundQuestions: 0, topics };
      }
      const index = Math.min(activeProgress.completedTopics ?? 0, topics.length);
      if (index < topics.length) {
        const batch = topics.slice(index, index + PROBLEM_TOPIC_BATCH_SIZE);
        activeProgress = {
          ...activeProgress, state: "building", phase: "questions", completedTopics: index,
          totalTopics: topics.length, topics,
          currentTopic: `${batch[0]?.section ?? ""}｜${batch[0]?.topic ?? ""}`,
        };
        await writeChapterProgress(resourceId, activeProgress);
        const payload = await openAIJson("/responses", {
          method: "POST",
          body: JSON.stringify({
            model: extractionModel,
            instructions: "你是台灣司律考試解題書編輯。必須使用 file_search 逐一搜尋指定主題，只能抄錄書中明確存在的題型、完整題目與該題後方的解析或擬答。title 原樣保留題型編號與名稱；stem 只放完整題目本文；content 依原書順序保存該題完整題目、爭點解析、規範、涵攝、結論與擬答，不得自行摘要或補造。section、topic 必須使用指定目錄名稱。保留原書順序；找不到解析時 content 仍須填入 stem，不得用一般法律知識補寫。",
            input: `教材：《${resource.title}》（${document.fileName}）\n本批只擷取下列主題中的全部題型與完整題目：\n${batch.map((item) => `${item.section}｜${item.topic}`).join("\n")}`,
            tools: [{ type: "file_search", vector_store_ids: [setting.value], max_num_results: PROBLEM_FILE_SEARCH_RESULTS }],
            text: { format: { type: "json_schema", name: "problem_book_questions", strict: true, schema: problemQuestionSchema } },
          }),
        });
        parsed = parseChapterPayload(payload);
        const pending = await readPendingChapters(resourceId);
        const existingKeys = new Set(pending.map((chapter) => `${chapter.lessonLabel}|${chapter.title}`));
        const newRows = parsed
          .filter(isCompleteProblemQuestion)
          .filter((chapter) => !existingKeys.has(`${String(chapter.section ?? "").trim()}｜${String(chapter.topic ?? "").trim()}|${String(chapter.title ?? "").trim()}`))
          .map((chapter, localIndex) => ({
            resourceId, segmentType: PENDING_CHAPTER_TYPE,
            lessonLabel: `${String(chapter.section ?? "").trim()}｜${String(chapter.topic ?? "").trim()}`.slice(0, 160),
            title: String(chapter.title ?? "").trim().slice(0, 160),
            pageStart: chapter.page_start == null ? null : Math.max(1, Number(chapter.page_start) || 1),
            pageEnd: chapter.page_end == null ? null : Math.max(1, Number(chapter.page_end) || 1),
            text: String(chapter.content ?? chapter.stem ?? "").trim().slice(0, SOURCE_TEXT_MAX_LENGTH),
            sequence: index * 1000 + localIndex + 1,
            summary: String(chapter.summary ?? "").trim().slice(0, 240),
            reviewStatus: "ai_reviewed",
          }));
        if (newRows.length) await db.insert(resourceSegments).values(newRows);
        const foundQuestions = pending.length + newRows.length;
        activeProgress = {
          ...activeProgress, state: "building", phase: "questions", completedTopics: index + 1,
          totalTopics: topics.length, foundQuestions,
          currentTopic: topics[index + 1] ? `${topics[index + 1].section}｜${topics[index + 1].topic}` : "",
          topics,
        };
        await writeChapterProgress(resourceId, {
          ...activeProgress,
        });
        if (index + 1 < topics.length) {
          return Response.json({ status: "building", progress: progressForResponse(activeProgress, new Date()) }, { status: 202 });
        }
      }
    } else {
      const payload = await openAIJson("/responses", {
      method: "POST",
      body: JSON.stringify({
        model: extractionModel,
        instructions: "你是台灣司律考試教材編輯。必須先使用 file_search 搜尋已建立的教材索引，只能根據該書已索引內容整理目錄、篇、章與節；不得讀取或要求重新上傳整份 PDF，也不得自行創造不存在的章名。保留原有順序。content 只能抄錄搜尋結果中能確認的章節原文片段；若沒有足夠原文就填空字串，不得用摘要或一般法律知識代替。若頁碼無法確認填 null。summary 只用索引片段可支持的 20 至 60 字說明。最多 80 筆，重複或只是頁眉頁碼的項目不要回傳。",
        input: `請從已索引的教材《${resource.title}》（原始檔名：${document.fileName}）搜尋目錄與章節標題，依檔案中的原有順序輸出。只回傳檔案明確出現的章節，並在 content 填入可核對的原文片段。`,
        tools: [
          {
            type: "file_search",
            vector_store_ids: [setting.value],
            max_num_results: problemBook ? 50 : 20,
          },
        ],
        text: {
          format: {
            type: "json_schema",
            name: "book_chapters",
            strict: true,
            schema: problemQuestionSchema,
          },
        },
      }),
      });
      parsed = parseChapterPayload(payload);
    }
    const pendingChapters = problemBook ? await readPendingChapters(resourceId) : [];
    const generated = problemBook ? pendingChapters : parsed;
    if (!generated.length || (problemBook && generated.length < MIN_COMPLETE_PROBLEM_QUESTIONS)) {
      await writeChapterProgress(resourceId, { ...activeProgress, state: "failed", phase: "failed", foundQuestions: generated.length, error: "本次未達最低完整度，原資料未被覆蓋。" });
      return Response.json(
        {
          error: problemBook
            ? `本次只辨識到 ${generated.length} 道完整題目，未達最低完整度，因此不會覆蓋既有資料。請確認 PDF 文字索引與目錄完整後再試。`
            : "索引中找不到可辨識的目錄章節；請確認 PDF 內有目錄，或稍後由管理後台重新建立。",
        },
        { status: 422 },
      );
    }

    const rows = generated.map((chapter, index) => ({
      resourceId,
      segmentType: "book_chapter",
      lessonLabel: problemBook
        ? `${String(chapter.section ?? "").trim()}｜${String(chapter.topic ?? "").trim()}`.slice(
            0,
            160,
          )
        : "教材章節",
      title: String(chapter.title ?? "")
        .trim()
        .slice(0, 160),
      pageStart:
        chapter.page_start == null
          ? null
          : Math.max(1, Number(chapter.page_start) || 1),
      pageEnd:
        chapter.page_end == null
          ? null
          : Math.max(1, Number(chapter.page_end) || 1),
      text: String(chapter.content ?? chapter.text ?? chapter.original_text ?? chapter.stem ?? "")
        .trim()
        .slice(0, 12000),
      sequence: index + 1,
      summary: String(chapter.summary ?? "")
        .trim()
        .slice(0, 240),
      reviewStatus: "ai_reviewed",
    }));
    const inserted: (typeof resourceSegments.$inferSelect)[] = [];
    try {
      if (existing.length) {
        await db
          .delete(resourceSegments)
          .where(
            and(
              eq(resourceSegments.resourceId, resourceId),
              inArray(resourceSegments.segmentType, [...CHAPTER_TYPES]),
            ),
          );
      }
      if (problemBook) {
        await db.update(resourceSegments).set({ segmentType: "book_chapter" }).where(
          and(eq(resourceSegments.resourceId, resourceId), eq(resourceSegments.segmentType, PENDING_CHAPTER_TYPE)),
        );
        inserted.push(...(await readChapters(resourceId)));
      } else {
        for (
          let index = 0;
          index < rows.length;
          index += CHAPTER_INSERT_BATCH_SIZE
        ) {
          inserted.push(
            ...(await db
              .insert(resourceSegments)
              .values(rows.slice(index, index + CHAPTER_INSERT_BATCH_SIZE))
              .returning()),
          );
        }
      }
      await writeChapterProgress(resourceId, { state: "completed", phase: "saving", foundQuestions: inserted.length, completedTopics: activeProgress.completedTopics, totalTopics: activeProgress.totalTopics, topics: activeProgress.topics });
      return Response.json({
        chapters: inserted,
        generated: true,
        reused: false,
        status: "completed",
      });
    } catch (insertError) {
      // A failed later batch must not leave a partial outline that a retry
      // would mistake for a completed chapter index.
      if (inserted.length) {
        await db
          .delete(resourceSegments)
          .where(
            and(
              eq(resourceSegments.resourceId, resourceId),
              inArray(resourceSegments.segmentType, [...CHAPTER_TYPES]),
            ),
          );
      }
      throw insertError;
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message.slice(0, 240) : "建立章節索引失敗";
    const paused = /較忙|限流|rate.?limit|429|try again/i.test(message);
    if (resourceId && !sourceBatchRequested) {
      try {
        const progress = activeProgress ?? (await readChapterProgressRecord(resourceId)).progress;
        await writeChapterProgress(resourceId, {
          ...progress,
          state: paused ? "paused" : "failed",
          phase: paused ? "paused" : "failed",
          error: paused ? "AI 目前較忙；已保留原資料，稍後可重新執行解析。" : message,
        });
      } catch {
        /* preserve original error */
      }
    }
    return Response.json({ error: paused ? undefined : message, status: paused ? "paused" : "failed" }, { status: paused ? 202 : 500 });
  }
}
