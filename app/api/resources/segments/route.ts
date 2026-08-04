import { and, asc, eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { learningResources, resourceSegments } from "../../../../db/schema";
import { getOpenAIModel, openAIJson } from "../../../../lib/openai";
import { decodeSubtitle, looksLikeRawSrt, parseSrt, parseSrtCues } from "../../../../lib/srt";

function timeLabel(value: number) {
  const total = Math.max(0, Math.floor(value));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

type DigestRow = {
  anchorId: number;
  title: string;
  summary: string;
};

function cleanJsonText(value: string) {
  return value.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
}

function makeDigestWindows<T extends { startSeconds: number | null; text: string }>(rows: T[]) {
  const windows: T[][] = [];
  let current: T[] = [];
  let windowStart = rows[0]?.startSeconds ?? 0;
  for (const row of rows) {
    const start = row.startSeconds ?? windowStart;
    if (current.length && (start - windowStart >= 360 || current.length >= 45)) {
      windows.push(current);
      current = [];
      windowStart = start;
    }
    current.push(row);
  }
  if (current.length) windows.push(current);
  return windows;
}

function compactExistingSummaries(rows: Array<typeof resourceSegments.$inferSelect>) {
  return makeDigestWindows(rows.filter((row) => row.segmentType === "subtitle"))
    .map((window) => window
      .filter((row) => row.summary.trim() || row.recommended)
      .sort((a, b) => (b.importance - a.importance) || (a.sequence - b.sequence))[0])
    .filter((row): row is typeof rows[number] => Boolean(row));
}

async function createCourseDigest(db: Awaited<ReturnType<typeof getDb>>, rows: Array<typeof resourceSegments.$inferSelect>) {
  const windows = makeDigestWindows(rows);
  const digest: Array<DigestRow & { sourceSequence: number }> = [];
  const model = await getOpenAIModel("gpt-5.6-luna");

  for (const window of windows) {
    const payload = await openAIJson("/responses", {
      method: "POST",
      body: JSON.stringify({
        model,
        instructions: "你是台灣司律考試影音課程編輯。請把這一段連續課程整理成 1 個最值得學生記住的摘要重點；只有在內容確實包含兩個完全不同的考點時才輸出 2 個。不要逐句摘要，不要照抄字幕，不要補造字幕沒有的內容。每個重點要有 8 至 20 字的主題標題、30 至 70 字的繁中摘要，並選出最能代表該重點的字幕 anchorId。輸出 JSON。",
        input: JSON.stringify(window.map((item) => ({
          anchorId: item.id,
          start: item.startSeconds,
          end: item.endSeconds,
          text: item.text,
        }))),
        text: {
          format: {
            type: "json_schema",
            name: "course_digest",
            strict: true,
            schema: {
              type: "object",
              additionalProperties: false,
              properties: {
                items: {
                  type: "array",
                  minItems: 1,
                  maxItems: 2,
                  items: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      anchorId: { type: "integer" },
                      title: { type: "string" },
                      summary: { type: "string" },
                    },
                    required: ["anchorId", "title", "summary"],
                  },
                },
              },
              required: ["items"],
            },
          },
        },
      }),
    });
    const parsed = JSON.parse(cleanJsonText(outputText(payload))) as { items?: DigestRow[] };
    const validIds = new Set(window.map((item) => item.id));
    for (const item of parsed.items ?? []) {
      if (!validIds.has(item.anchorId) || !item.title?.trim() || !item.summary?.trim()) continue;
      const source = window.find((row) => row.id === item.anchorId);
      if (!source) continue;
      digest.push({
        anchorId: item.anchorId,
        title: item.title.trim().slice(0, 40),
        summary: item.summary.trim().slice(0, 180),
        sourceSequence: source.sequence,
      });
    }
  }

  const uniqueDigest = Array.from(new Map(digest.map((item) => [item.anchorId, item])).values())
    .sort((a, b) => a.sourceSequence - b.sourceSequence);
  if (!uniqueDigest.length) throw new Error("AI 沒有產生可用的課程摘要");

  await db.update(resourceSegments).set({
    summary: "",
    importance: 0,
    recommended: false,
    reviewStatus: "source",
  }).where(eq(resourceSegments.resourceId, rows[0].resourceId));

  for (const item of uniqueDigest) {
    await db.update(resourceSegments).set({
      title: item.title,
      summary: item.summary,
      importance: 5,
      recommended: true,
      reviewStatus: "ai_digest",
    }).where(eq(resourceSegments.id, item.anchorId));
  }
  await db.update(learningResources).set({ updatedAt: new Date() }).where(eq(learningResources.id, rows[0].resourceId));
  return uniqueDigest.length;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const resourceId = Number(url.searchParams.get("resourceId"));
  const summaryOnly = url.searchParams.get("view") === "summary";
  const db = await getDb();
  const [resource] = await db.select().from(learningResources).where(eq(learningResources.id, resourceId)).limit(1);
  if (!resource) return Response.json({ error: "找不到課程" }, { status: 404 });
  let segments = await db.select().from(resourceSegments).where(eq(resourceSegments.resourceId, resourceId)).orderBy(asc(resourceSegments.sequence));
  if (summaryOnly) {
    const digest = segments.filter((segment) => segment.reviewStatus === "ai_digest" && segment.summary.trim());
    return Response.json({
      resource,
      segments: digest.length ? digest : compactExistingSummaries(segments),
      summaryMode: digest.length ? "ai_digest" : "compact_preview",
    });
  }
  return Response.json({ resource, segments });
}

export async function PUT(request: Request) {
  const body = await request.json() as Record<string, unknown>;
  const id = Number(body.id);
  if (!id) return Response.json({ error: "缺少內容片段" }, { status: 400 });
  const db = await getDb();
  const [current] = await db.select().from(resourceSegments).where(eq(resourceSegments.id, id)).limit(1);
  if (!current) return Response.json({ error: "找不到內容片段" }, { status: 404 });
  const has = (key: string) => Object.prototype.hasOwnProperty.call(body, key);
  const [segment] = await db.update(resourceSegments).set({
    startSeconds: has("startSeconds") ? Math.max(0, Number(body.startSeconds) || 0) : current.startSeconds,
    endSeconds: has("endSeconds") ? Math.max(0, Number(body.endSeconds) || 0) : current.endSeconds,
    text: has("text") ? String(body.text ?? "").trim() : current.text,
    summary: has("summary") ? String(body.summary ?? "").trim() : current.summary,
    importance: has("importance") ? Math.max(0, Math.min(5, Number(body.importance) || 0)) : current.importance,
    recommended: has("recommended") ? Boolean(body.recommended) : current.recommended,
    reviewStatus: has("reviewStatus") ? String(body.reviewStatus ?? "reviewed") : current.reviewStatus,
  }).where(eq(resourceSegments.id, id)).returning();
  return Response.json({ segment });
}

function outputText(payload: Record<string, unknown>) {
  if (typeof payload.output_text === "string" && payload.output_text.trim()) return payload.output_text.trim();
  const output = Array.isArray(payload.output) ? payload.output : [];
  for (const item of output) {
    if (!item || typeof item !== "object") continue;
    const content = Array.isArray((item as { content?: unknown[] }).content) ? (item as { content: unknown[] }).content : [];
    for (const part of content) if (part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string") return (part as { text: string }).text;
  }
  return "";
}

export async function POST(request: Request) {
  const body = await request.json() as { resourceId?: number; action?: string };
  const resourceId = Number(body.resourceId);
  const db = await getDb();
  const [resource] = await db.select().from(learningResources).where(eq(learningResources.id, resourceId)).limit(1);
  if (!resource) return Response.json({ error: "找不到課程" }, { status: 404 });
  const rows = await db.select().from(resourceSegments).where(and(eq(resourceSegments.resourceId, resourceId), eq(resourceSegments.segmentType, "subtitle"))).orderBy(asc(resourceSegments.sequence));
  if (!rows.length) return Response.json({ error: "此課程尚未上傳字幕" }, { status: 400 });

  if (body.action === "repair") {
    const raw = rows.map((row) => row.text).join("\n\n");
    if (!looksLikeRawSrt(raw)) return Response.json({ repaired: false, segments: rows.length });
    const groups = parseSrt(raw);
    if (!groups.length)
      return Response.json({ error: "找不到可重建的 SRT 時間碼" }, { status: 422 });
    await db.delete(resourceSegments).where(and(eq(resourceSegments.resourceId, resourceId), eq(resourceSegments.segmentType, "subtitle")));
    const rebuilt = groups.map((group, index) => ({
      resourceId,
      segmentType: "subtitle",
      lessonLabel: rows[0]?.lessonLabel ?? "",
      title: `${timeLabel(group.start)}－${timeLabel(group.end)}`,
      startSeconds: group.start,
      endSeconds: group.end,
      text: group.text,
      sequence: index + 1,
    }));
    for (let index = 0; index < rebuilt.length; index += 4)
      await db.insert(resourceSegments).values(rebuilt.slice(index, index + 4));
    await db.update(learningResources).set({ updatedAt: new Date() }).where(eq(learningResources.id, resourceId));
    return Response.json({ repaired: true, segments: rebuilt.length });
  }

  if (!body.action || body.action === "digest") {
    try {
      const digestCount = await createCourseDigest(db, rows);
      return Response.json({ analyzed: digestCount, digestCount });
    } catch (error) {
      const message = error instanceof Error ? error.message : "AI 摘要分析失敗";
      console.error(`[resources/segments] course digest failed: ${message.slice(0, 500)}`);
      return Response.json({ error: `字幕已建立 ${rows.length} 段，但 AI 摘要尚未完成：${message.slice(0, 160)}` }, { status: 502 });
    }
  }

  let analyzed = 0;
  try {
    for (let index = 0; index < rows.length; index += 12) {
    const batch = rows.slice(index, index + 12);
    const payload = await openAIJson("/responses", { method: "POST", body: JSON.stringify({
      model: process.env.OPENAI_MODEL || "gpt-5.6-luna",
      instructions: "你是台灣司律考試課程編輯。依字幕判斷是否值得推薦考生。只根據內容，不補造。importance 0到5；3以上可推薦。summary用繁中20到45字，指出考點或學習價值。回傳JSON陣列。",
      input: JSON.stringify(batch.map((item) => ({ id: item.id, start: item.startSeconds, end: item.endSeconds, text: item.text }))),
      text: { format: { type: "json_schema", name: "segment_analysis", strict: true, schema: { type: "object", additionalProperties: false, properties: { items: { type: "array", items: { type: "object", additionalProperties: false, properties: { id: { type: "integer" }, summary: { type: "string" }, importance: { type: "integer" }, recommended: { type: "boolean" } }, required: ["id", "summary", "importance", "recommended"] } } }, required: ["items"] } } },
    }) });
      const raw = outputText(payload).replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
      const parsed = JSON.parse(raw) as { items?: Array<{ id: number; summary: string; importance: number; recommended: boolean }> };
      for (const item of parsed.items ?? []) {
        await db.update(resourceSegments).set({ summary: item.summary.slice(0, 160), importance: Math.max(0, Math.min(5, item.importance)), recommended: item.recommended, reviewStatus: "ai_reviewed" }).where(eq(resourceSegments.id, item.id));
        analyzed += 1;
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "AI 回覆格式無法辨識";
    console.error(`[resources/segments] AI subtitle analysis failed after ${analyzed} segments: ${message.slice(0, 500)}`);
    return Response.json({ error: `字幕已建立 ${rows.length} 段，但 AI 分析暫時未完成；可稍後按「校正字幕／重點」再分析。`, analyzed }, { status: 502 });
  }
  return Response.json({ analyzed });
}
