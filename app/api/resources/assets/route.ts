import { and, eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { learningResources, resourceSegments } from "../../../../db/schema";

function seconds(value: string) {
  const [h, m, tail] = value.replace(",", ".").split(":");
  return Math.round(Number(h) * 3600 + Number(m) * 60 + Number(tail));
}

function parseSrt(raw: string) {
  const cues = raw.replaceAll("\r", "").trim().split(/\n\n+/).map((block) => {
    const lines = block.split("\n");
    const timeIndex = lines.findIndex((line) => line.includes("-->"));
    if (timeIndex < 0) return null;
    const [start, end] = lines[timeIndex].split("-->").map((item) => item.trim());
    return { start: seconds(start), end: seconds(end), text: lines.slice(timeIndex + 1).join(" ").replace(/<[^>]+>/g, "").trim() };
  }).filter((cue): cue is { start: number; end: number; text: string } => Boolean(cue?.text));
  const groups: Array<{ start: number; end: number; text: string }> = [];
  for (const cue of cues) {
    const current = groups.at(-1);
    if (!current || cue.end - current.start > 90 || current.text.length > 650) groups.push({ ...cue });
    else { current.end = cue.end; current.text += ` ${cue.text}`; }
  }
  return groups;
}

export async function POST(request: Request) {
  const form = await request.formData();
  const resourceId = Number(form.get("resourceId"));
  const assetType = String(form.get("assetType") ?? "");
  const file = form.get("file");
  if (!resourceId || !(file instanceof File)) return Response.json({ error: "缺少資源或檔案" }, { status: 400 });
  const db = await getDb();
  const [resource] = await db.select().from(learningResources).where(eq(learningResources.id, resourceId)).limit(1);
  if (!resource) return Response.json({ error: "找不到資源" }, { status: 404 });

  if (assetType === "cover") {
    if (!file.type.startsWith("image/") || file.size > 8 * 1024 * 1024) return Response.json({ error: "書封需為 8MB 以下圖片" }, { status: 400 });
    const { env } = await import("cloudflare:workers");
    const key = `resources/${resourceId}/cover-${Date.now()}`;
    await env.BUCKET.put(key, file.stream(), { httpMetadata: { contentType: file.type } });
    if (resource.coverStorageKey) await env.BUCKET.delete(resource.coverStorageKey);
    await db.update(learningResources).set({ coverStorageKey: key, updatedAt: new Date() }).where(eq(learningResources.id, resourceId));
    return Response.json({ ok: true });
  }

  if (assetType === "subtitle") {
    if (!file.name.toLowerCase().endsWith(".srt") || file.size > 8 * 1024 * 1024) return Response.json({ error: "請上傳 8MB 以下 SRT 字幕" }, { status: 400 });
    const lessonLabel = file.name.replace(/\.srt$/i, "");
    const groups = parseSrt(await file.text());
    await db.delete(resourceSegments).where(and(eq(resourceSegments.resourceId, resourceId), eq(resourceSegments.lessonLabel, lessonLabel)));
    if (groups.length) await db.insert(resourceSegments).values(groups.map((group, index) => ({ resourceId, segmentType: "subtitle", lessonLabel, title: `${Math.floor(group.start / 60)}:${String(group.start % 60).padStart(2, "0")}－${Math.floor(group.end / 60)}:${String(group.end % 60).padStart(2, "0")}`, startSeconds: group.start, endSeconds: group.end, text: group.text, sequence: index + 1 })));
    await db.update(learningResources).set({ updatedAt: new Date() }).where(eq(learningResources.id, resourceId));
    return Response.json({ ok: true, segments: groups.length, lessonLabel });
  }
  return Response.json({ error: "不支援的檔案類型" }, { status: 400 });
}
