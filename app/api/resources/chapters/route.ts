import { and, asc, eq, inArray } from "drizzle-orm";
import { getDb } from "../../../../db";
import {
  appSettings,
  documents,
  learningResources,
  resourceSegments,
} from "../../../../db/schema";
import { openAIJson } from "../../../../lib/openai";

const CHAPTER_TYPES = ["book_chapter", "chapter", "book_outline"] as const;
// Temporary rows keep a resumable extraction invisible to students until the
// minimum complete-question threshold is reached and the job is finalized.
const PENDING_CHAPTER_TYPE = "book_chapter_pending";
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
    section?: string;
    topic?: string;
    stem?: string;
    summary?: string;
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

function chapterStatusKey(resourceId: number) {
  return `book_chapters_status:${resourceId}`;
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
      return Response.json({ resourceId, status: progress.state, progress });
    }
    const status = progress.state;
    const problemBook = isProblemBook(resource);
    const usableChapters = problemBook
      ? chapters.filter(isCompleteProblemQuestion)
      : chapters;
    if (
      usableChapters.length &&
      (!problemBook || usableChapters.length >= MIN_COMPLETE_PROBLEM_QUESTIONS)
    ) {
      return Response.json({
        chapters: usableChapters,
        generated: false,
        ready: true,
        status: "completed",
        progress,
      });
    }

    if (problemBook && chapters.length) {
      return Response.json({
        chapters: [],
        generated: false,
        ready: false,
        status: "needs_rebuild",
        invalidCount: chapters.length,
        progress,
        message:
          usableChapters.length > 0
            ? `目前只擷取到 ${usableChapters.length} 道完整題目，明顯未涵蓋整本解題書；請到後台重新分批擷取。`
            : `現有 ${chapters.length} 筆只有主題名稱，尚未擷取題型與完整題目；請到後台重新擷取題型。`,
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
  try {
    const body = (await request.json()) as {
      resourceId?: number;
      rebuild?: boolean;
    };
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

    const problemBook = isProblemBook(resource);
    const existing = await readChapters(resourceId);
    const validExisting = problemBook
      ? existing.filter(isCompleteProblemQuestion)
      : existing;
    if (validExisting.length && !body.rebuild)
      return Response.json({
        chapters: validExisting,
        generated: false,
        reused: true,
        status: "completed",
      });

    const progressRecord = await readChapterProgressRecord(resourceId);
    let activeProgress = progressRecord.progress;

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
    const shouldRestartCompleted = problemBook && activeProgress.state === "failed"
      && activeProgress.totalTopics != null
      && activeProgress.completedTopics != null
      && activeProgress.completedTopics >= activeProgress.totalTopics;
    if (problemBook && (!topics?.length || shouldRestartCompleted)) {
      const pending = await readPendingChapters(resourceId);
      if (pending.length) {
        await db.delete(resourceSegments).where(
          and(eq(resourceSegments.resourceId, resourceId), eq(resourceSegments.segmentType, PENDING_CHAPTER_TYPE)),
        );
      }
      await writeChapterProgress(resourceId, {
        state: "building", phase: "outline", completedTopics: 0,
        totalTopics: 0, foundQuestions: 0,
      });
      activeProgress = { state: "building", phase: "outline", completedTopics: 0, totalTopics: 0, foundQuestions: 0 };
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
              page_start: { type: ["integer", "null"] },
              page_end: { type: ["integer", "null"] },
            },
            required: ["title", "section", "topic", "stem", "summary", "page_start", "page_end"],
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
            instructions: "你是台灣司律考試解題書編輯。必須使用 file_search 逐一搜尋指定主題，只能抄錄書中明確存在的題型與完整題目。title 原樣保留題型編號與名稱；stem 必須是完整題目本文，不得放解析；section、topic 必須使用指定目錄名稱。不得用一般法律知識補題。保留原書順序。",
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
            text: String(chapter.stem ?? "").trim().slice(0, 12000),
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
        instructions: "你是台灣司律考試教材編輯。必須先使用 file_search 搜尋已建立的教材索引，只能根據該書已索引內容整理目錄、篇、章與節；不得讀取或要求重新上傳整份 PDF，也不得自行創造不存在的章名。保留原有順序。若頁碼無法確認填 null。summary 只用索引片段可支持的 20 至 60 字說明。最多 80 筆，重複或只是頁眉頁碼的項目不要回傳。",
        input: `請從已索引的教材《${resource.title}》（原始檔名：${document.fileName}）搜尋目錄與章節標題，依檔案中的原有順序輸出。只回傳檔案明確出現的章節。`,
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
      text: String(chapter.stem ?? "")
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
    if (resourceId) {
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
