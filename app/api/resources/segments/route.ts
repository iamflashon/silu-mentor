import { and, asc, eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { learningResources, resourceSegments } from "../../../../db/schema";
import { openAIJson } from "../../../../lib/openai";

export async function GET(request: Request) {
  const resourceId = Number(new URL(request.url).searchParams.get("resourceId"));
  const db = await getDb();
  const [resource] = await db.select().from(learningResources).where(eq(learningResources.id, resourceId)).limit(1);
  if (!resource) return Response.json({ error: "找不到課程" }, { status: 404 });
  const segments = await db.select().from(resourceSegments).where(eq(resourceSegments.resourceId, resourceId)).orderBy(asc(resourceSegments.sequence));
  return Response.json({ resource, segments });
}

export async function PUT(request: Request) {
  const body = await request.json() as Record<string, unknown>;
  const id = Number(body.id);
  if (!id) return Response.json({ error: "缺少字幕片段" }, { status: 400 });
  const db = await getDb();
  const [segment] = await db.update(resourceSegments).set({
    startSeconds: Math.max(0, Number(body.startSeconds) || 0),
    endSeconds: Math.max(0, Number(body.endSeconds) || 0),
    text: String(body.text ?? "").trim(),
    summary: String(body.summary ?? "").trim(),
    importance: Math.max(0, Math.min(5, Number(body.importance) || 0)),
    recommended: Boolean(body.recommended),
    reviewStatus: String(body.reviewStatus ?? "reviewed"),
  }).where(eq(resourceSegments.id, id)).returning();
  return Response.json({ segment });
}

function outputText(payload: Record<string, unknown>) {
  const output = Array.isArray(payload.output) ? payload.output : [];
  for (const item of output) {
    if (!item || typeof item !== "object") continue;
    const content = Array.isArray((item as { content?: unknown[] }).content) ? (item as { content: unknown[] }).content : [];
    for (const part of content) if (part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string") return (part as { text: string }).text;
  }
  return "";
}

export async function POST(request: Request) {
  const body = await request.json() as { resourceId?: number };
  const resourceId = Number(body.resourceId);
  const db = await getDb();
  const [resource] = await db.select().from(learningResources).where(eq(learningResources.id, resourceId)).limit(1);
  if (!resource) return Response.json({ error: "找不到課程" }, { status: 404 });
  const rows = await db.select().from(resourceSegments).where(and(eq(resourceSegments.resourceId, resourceId), eq(resourceSegments.segmentType, "subtitle"))).orderBy(asc(resourceSegments.sequence));
  if (!rows.length) return Response.json({ error: "此課程尚未上傳字幕" }, { status: 400 });
  let analyzed = 0;
  for (let index = 0; index < rows.length; index += 12) {
    const batch = rows.slice(index, index + 12);
    const payload = await openAIJson("/responses", { method: "POST", body: JSON.stringify({
      model: process.env.OPENAI_MODEL || "gpt-5.6-luna",
      instructions: "你是台灣司律考試課程編輯。依字幕判斷是否值得推薦考生。只根據內容，不補造。importance 0到5；3以上可推薦。summary用繁中20到45字，指出考點或學習價值。回傳JSON陣列。",
      input: JSON.stringify(batch.map((item) => ({ id: item.id, start: item.startSeconds, end: item.endSeconds, text: item.text }))),
      text: { format: { type: "json_schema", name: "segment_analysis", strict: true, schema: { type: "object", additionalProperties: false, properties: { items: { type: "array", items: { type: "object", additionalProperties: false, properties: { id: { type: "integer" }, summary: { type: "string" }, importance: { type: "integer" }, recommended: { type: "boolean" } }, required: ["id", "summary", "importance", "recommended"] } } }, required: ["items"] } } },
    }) });
    const parsed = JSON.parse(outputText(payload)) as { items?: Array<{ id: number; summary: string; importance: number; recommended: boolean }> };
    for (const item of parsed.items ?? []) {
      await db.update(resourceSegments).set({ summary: item.summary.slice(0, 160), importance: Math.max(0, Math.min(5, item.importance)), recommended: item.recommended, reviewStatus: "ai_reviewed" }).where(eq(resourceSegments.id, item.id));
      analyzed += 1;
    }
  }
  return Response.json({ analyzed });
}
