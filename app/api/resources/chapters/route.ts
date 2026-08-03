import { asc, eq, inArray } from "drizzle-orm";
import { getDb } from "../../../../db";
import { appSettings, documents, learningResources, resourceSegments } from "../../../../db/schema";
import { openAIJson } from "../../../../lib/openai";

type ChapterPayload = {
  chapters?: Array<{
    title?: string;
    summary?: string;
    page_start?: number | null;
    page_end?: number | null;
  }>;
};

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
  const raw = outputText(payload).replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  try {
    const parsed = JSON.parse(raw) as ChapterPayload;
    return (parsed.chapters ?? []).filter((chapter) => String(chapter.title ?? "").trim()).slice(0, 60);
  } catch {
    return [] as ChapterPayload["chapters"];
  }
}

async function generateChapters(resource: typeof learningResources.$inferSelect, vectorStoreId: string) {
  if (!vectorStoreId) return [] as ChapterPayload["chapters"];
  const payload = await openAIJson("/responses", {
    method: "POST",
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || "gpt-5.6-luna",
      instructions: "你是台灣司律考試教材編輯。只能根據提供的教材檔案目錄與章節標題整理章節，不得自行創造不存在的章名。保留原有章節順序。若頁碼無法確認就填 null。每一章標題最多 80 字，summary 用 20 至 60 字說明該章在教材中的學習範圍。最多回傳 60 章。",
      input: `請從教材索引中搜尋《${resource.title}》的目錄、篇、章與節。只回傳這本書中明確出現且能在索引內容找到的章節，不要把頁眉、頁碼或一般段落當成章節。`,
      tools: [{ type: "file_search", vector_store_ids: [vectorStoreId], max_num_results: 20 }],
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
                maxItems: 60,
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
  return parseChapterPayload(payload);
}

export async function GET(request: Request) {
  try {
    const resourceId = Number(new URL(request.url).searchParams.get("resourceId"));
    if (!Number.isInteger(resourceId) || resourceId < 1) return Response.json({ error: "缺少書籍編號" }, { status: 400 });
    const db = await getDb();
    const [resource] = await db.select().from(learningResources).where(eq(learningResources.id, resourceId)).limit(1);
    if (!resource || resource.resourceType !== "book") return Response.json({ error: "找不到書籍" }, { status: 404 });

    const existing = await db.select().from(resourceSegments)
      .where(inArray(resourceSegments.segmentType, ["book_chapter", "chapter", "book_outline"]))
      .orderBy(asc(resourceSegments.sequence));
    const chapters = existing.filter((chapter) => chapter.resourceId === resourceId);
    if (chapters.length) return Response.json({ chapters, generated: false });

    if (!resource.documentId) return Response.json({ chapters: [], generated: false, ready: false, message: "這本書尚未綁定後台教材。" }, { status: 200 });
    const [document] = await db.select().from(documents).where(eq(documents.id, resource.documentId)).limit(1);
    if (!document?.openaiFileId) return Response.json({ chapters: [], generated: false, ready: false, message: "這本書尚未完成教材索引。" }, { status: 200 });
    if (document.status === "failed") {
      return Response.json({ chapters: [], generated: false, ready: false, message: document.indexError || "教材索引失敗，請到後台重新建立索引。" }, { status: 200 });
    }
    const [setting] = await db.select().from(appSettings).where(eq(appSettings.key, "openai_vector_store_id")).limit(1);
    if (!setting?.value) return Response.json({ chapters: [], generated: false, ready: false, message: "教材索引資料庫尚未建立。" }, { status: 200 });

    const generated = await generateChapters(resource, setting.value);
    if (!generated?.length) return Response.json({ chapters: [], generated: false, ready: true, message: "教材已完成索引，但目前還找不到可辨識的目錄章節；可稍後重新整理。" }, { status: 200 });
    const rows = generated.map((chapter, index) => ({
      resourceId,
      segmentType: "book_chapter",
      lessonLabel: "教材章節",
      title: String(chapter.title ?? "").trim().slice(0, 160),
      pageStart: chapter.page_start == null ? null : Math.max(1, Number(chapter.page_start) || 1),
      pageEnd: chapter.page_end == null ? null : Math.max(1, Number(chapter.page_end) || 1),
      summary: String(chapter.summary ?? "").trim().slice(0, 240),
      text: "",
      sequence: index + 1,
      reviewStatus: "ai_reviewed",
    }));
    for (let index = 0; index < rows.length; index += 12) await db.insert(resourceSegments).values(rows.slice(index, index + 12));
    return Response.json({ chapters: rows, generated: true, ready: true });
  } catch {
    return Response.json({ chapters: [], generated: false, ready: false, error: "教材章節暫時無法讀取，請稍後再試。" }, { status: 503 });
  }
}
