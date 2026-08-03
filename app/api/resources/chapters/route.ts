import { and, asc, eq, inArray } from "drizzle-orm";
import { getDb } from "../../../../db";
import { appSettings, documents, learningResources, resourceSegments } from "../../../../db/schema";
import { openAIJson } from "../../../../lib/openai";

const CHAPTER_TYPES = ["book_chapter", "chapter", "book_outline"] as const;
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
    summary?: string;
    page_start?: number | null;
    page_end?: number | null;
  }>;
};

function chapterStatusKey(resourceId: number) {
  return `book_chapters_status:${resourceId}`;
}

function outputText(payload: Record<string, unknown>) {
  if (typeof payload.output_text === "string") return payload.output_text.trim();
  const output = Array.isArray(payload.output) ? payload.output : [];
  return output.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const content = Array.isArray((item as { content?: unknown[] }).content)
      ? (item as { content: unknown[] }).content
      : [];
    return content.flatMap((part) =>
      part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string"
        ? [(part as { text: string }).text]
        : [],
    );
  }).join("").trim();
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

async function readChapterStatus(resourceId: number) {
  const db = await getDb();
  const [setting] = await db
    .select()
    .from(appSettings)
    .where(eq(appSettings.key, chapterStatusKey(resourceId)))
    .limit(1);
  return setting?.value ?? "not_started";
}

async function writeChapterStatus(resourceId: number, value: string) {
  const db = await getDb();
  await db.insert(appSettings)
    .values({ key: chapterStatusKey(resourceId), value, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: { value, updatedAt: new Date() },
    });
}

async function readChapters(resourceId: number) {
  const db = await getDb();
  return db.select().from(resourceSegments)
    .where(and(
      eq(resourceSegments.resourceId, resourceId),
      inArray(resourceSegments.segmentType, [...CHAPTER_TYPES]),
    ))
    .orderBy(asc(resourceSegments.sequence))
}

/**
 * Read-only endpoint for students.
 *
 * Important: this endpoint must never send a PDF to an AI model. Chapter
 * extraction is an explicit, one-time admin action handled by POST below.
 */
export async function GET(request: Request) {
  try {
    const resourceId = Number(new URL(request.url).searchParams.get("resourceId"));
    if (!Number.isInteger(resourceId) || resourceId < 1)
      return Response.json({ error: "缺少書籍編號" }, { status: 400 });

    const db = await getDb();
    const [resource] = await db.select().from(learningResources)
      .where(eq(learningResources.id, resourceId)).limit(1);
    if (!resource || resource.resourceType !== "book")
      return Response.json({ error: "找不到書籍" }, { status: 404 });

    const chapters = await readChapters(resourceId);
    const status = await readChapterStatus(resourceId);
    if (chapters.length) {
      return Response.json({ chapters, generated: false, ready: true, status: "completed" });
    }

    if (!resource.documentId) {
      return Response.json({ chapters: [], generated: false, ready: false, status, message: "這本書尚未綁定後台教材。" });
    }
    const [document] = await db.select().from(documents)
      .where(eq(documents.id, resource.documentId)).limit(1);
    if (!document?.openaiFileId) {
      return Response.json({ chapters: [], generated: false, ready: false, status, message: "這本書尚未完成教材索引。" });
    }
    if (document.status !== "completed") {
      return Response.json({
        chapters: [],
        generated: false,
        ready: false,
        status,
        documentStatus: document.status,
        message: document.status === "failed"
          ? (document.indexError || "教材索引失敗，請到後台重新建立索引。")
          : "教材正在建立索引，完成後請再讀取章節。",
      }, { status: 202 });
    }
    if (status === "building") {
      return Response.json({ chapters: [], generated: false, ready: false, status, message: "後台正在建立章節索引，完成後即可讀取。" }, { status: 202 });
    }
    if (status === "failed") {
      return Response.json({ chapters: [], generated: false, ready: true, status, message: "章節索引曾建立失敗；請由管理後台明確按下「建立章節索引」再試一次。" });
    }
    return Response.json({ chapters: [], generated: false, ready: true, status: "not_started", message: "教材已完成索引，但章節目錄尚未建立；請由管理後台建立一次章節索引。" });
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 240) : "教材章節暫時無法讀取，請稍後再試。";
    return Response.json({ chapters: [], generated: false, ready: false, error: message }, { status: 503 });
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
    const body = await request.json() as { resourceId?: number };
    resourceId = Number(body.resourceId);
    if (!Number.isInteger(resourceId) || resourceId < 1)
      return Response.json({ error: "缺少書籍編號" }, { status: 400 });

    const db = await getDb();
    const [resource] = await db.select().from(learningResources)
      .where(eq(learningResources.id, resourceId)).limit(1);
    if (!resource || resource.resourceType !== "book")
      return Response.json({ error: "找不到書籍" }, { status: 404 });

    const existing = await readChapters(resourceId);
    if (existing.length) return Response.json({ chapters: existing, generated: false, reused: true, status: "completed" });

    const status = await readChapterStatus(resourceId);
    if (status === "building") return Response.json({ error: "章節索引正在建立中，請稍後再試。", status }, { status: 202 });

    if (!resource.documentId) return Response.json({ error: "這本書尚未綁定後台教材。" }, { status: 400 });
    const [document] = await db.select().from(documents)
      .where(eq(documents.id, resource.documentId)).limit(1);
    if (!document?.openaiFileId) return Response.json({ error: "這本書尚未完成教材索引，請先完成 PDF 索引。" }, { status: 409 });
    if (document.status !== "completed") return Response.json({ error: "PDF 尚未完成教材索引，完成後才能建立章節。", documentStatus: document.status }, { status: 409 });

    const [setting] = await db.select().from(appSettings)
      .where(eq(appSettings.key, "openai_vector_store_id")).limit(1);
    if (!setting?.value) return Response.json({ error: "教材向量索引尚未就緒。" }, { status: 409 });

    await writeChapterStatus(resourceId, "building");
    const payload = await openAIJson("/responses", {
      method: "POST",
      body: JSON.stringify({
        model: process.env.OPENAI_EXTRACTION_MODEL || process.env.OPENAI_MODEL || "gpt-5.6-luna",
        instructions: "你是台灣司律考試教材編輯。必須先使用 file_search 搜尋已建立的教材索引，只能根據該書已索引內容整理目錄、篇、章與節；不得讀取或要求重新上傳整份 PDF，也不得自行創造不存在的章名。保留原有順序。若頁碼無法確認填 null。summary 只用索引片段可支持的 20 至 60 字說明。最多 80 筆，重複或只是頁眉頁碼的項目不要回傳。",
        input: `請從已索引的教材《${resource.title}》（原始檔名：${document.fileName}）搜尋目錄與章節標題，依檔案中的原有順序輸出。只回傳檔案明確出現的章節。`,
        tools: [{ type: "file_search", vector_store_ids: [setting.value], max_num_results: 20 }],
        text: {
          format: {
            type: "json_schema",
            name: "book_chapters",
            strict: true,
            schema: {
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
                      summary: { type: "string" },
                      page_start: { type: ["integer", "null"] },
                      page_end: { type: ["integer", "null"] },
                    },
                    required: ["title", "summary", "page_start", "page_end"],
                  },
                },
              },
              required: ["chapters"],
            },
          },
        },
      }),
    });
    const generated = parseChapterPayload(payload);
    if (!generated.length) {
      await writeChapterStatus(resourceId, "failed");
      return Response.json({ error: "索引中找不到可辨識的目錄章節；請確認 PDF 內有目錄，或稍後由管理後台重新建立。" }, { status: 422 });
    }

    const rows = generated.map((chapter, index) => ({
      resourceId,
      segmentType: "book_chapter",
      lessonLabel: "教材章節",
      title: String(chapter.title ?? "").trim().slice(0, 160),
      pageStart: chapter.page_start == null ? null : Math.max(1, Number(chapter.page_start) || 1),
      pageEnd: chapter.page_end == null ? null : Math.max(1, Number(chapter.page_end) || 1),
      text: "",
      sequence: index + 1,
      summary: String(chapter.summary ?? "").trim().slice(0, 240),
      reviewStatus: "ai_reviewed",
    }));
    const inserted: typeof resourceSegments.$inferSelect[] = [];
    try {
      for (let index = 0; index < rows.length; index += CHAPTER_INSERT_BATCH_SIZE) {
        inserted.push(...await db.insert(resourceSegments).values(rows.slice(index, index + CHAPTER_INSERT_BATCH_SIZE)).returning());
      }
      await writeChapterStatus(resourceId, "completed");
      return Response.json({ chapters: inserted, generated: true, reused: false, status: "completed" });
    } catch (insertError) {
      // A failed later batch must not leave a partial outline that a retry
      // would mistake for a completed chapter index.
      if (inserted.length) {
        await db.delete(resourceSegments).where(and(
          eq(resourceSegments.resourceId, resourceId),
          inArray(resourceSegments.segmentType, [...CHAPTER_TYPES]),
        ));
      }
      throw insertError;
    }
  } catch (error) {
    if (resourceId) {
      try { await writeChapterStatus(resourceId, "failed"); } catch { /* preserve original error */ }
    }
    const message = error instanceof Error ? error.message.slice(0, 240) : "建立章節索引失敗";
    return Response.json({ error: message, status: "failed" }, { status: 500 });
  }
}
