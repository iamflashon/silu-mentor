import { and, eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { learningResources, resourceSegments } from "../../../../db/schema";

function seconds(value: string) {
  const normalized = value.trim().replace(",", ".");
  const parts = normalized.split(":");
  if (parts.length === 3) {
    const [h, m, s] = parts.map(Number);
    if (![h, m, s].every(Number.isFinite)) return NaN;
    return Math.round(h * 3600 + m * 60 + s);
  }
  if (parts.length === 2) {
    const [m, s] = parts.map(Number);
    if (![m, s].every(Number.isFinite)) return NaN;
    return Math.round(m * 60 + s);
  }
  return NaN;
}

function parseSrt(raw: string) {
  const normalized = raw.replace(/^\uFEFF/, "").replace(/\r/g, "").trim();
  const cuePattern = /(?:^|\n)\s*(?:\d+\s*\n)?\s*(\d{1,2}:\d{2}(?::\d{2})?[,.]\d{1,3})\s*-->\s*(\d{1,2}:\d{2}(?::\d{2})?[,.]\d{1,3})[^\n]*\n([\s\S]*?)(?=\n\s*(?:\d+\s*\n)?\s*\d{1,2}:\d{2}(?::\d{2})?[,.]\d{1,3}\s*-->|$)/g;
  const cues: Array<{ start: number; end: number; text: string }> = [];
  for (const match of normalized.matchAll(cuePattern)) {
    const start = seconds(match[1]);
    const end = seconds(match[2]);
    const text = match[3]
      .replace(/<[^>]+>/g, "")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .join(" ")
      .trim();
    if (text && Number.isFinite(start) && Number.isFinite(end) && end >= start)
      cues.push({ start, end, text });
  }
  const groups: Array<{ start: number; end: number; text: string }> = [];
  for (const cue of cues) {
    const current = groups.at(-1);
    if (!current || cue.end - current.start > 90 || current.text.length > 650)
      groups.push({ ...cue });
    else {
      current.end = cue.end;
      current.text += ` ${cue.text}`;
    }
  }
  return groups;
}

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const resourceId = Number(form.get("resourceId"));
    const assetType = String(form.get("assetType") ?? "");
    const file = form.get("file");
    if (!resourceId || !(file instanceof File))
      return Response.json({ error: "缺少資源或檔案" }, { status: 400 });
    const db = await getDb();
    const [resource] = await db
      .select()
      .from(learningResources)
      .where(eq(learningResources.id, resourceId))
      .limit(1);
    if (!resource)
      return Response.json({ error: "找不到資源" }, { status: 404 });

    if (assetType === "cover") {
      if (!file.type.startsWith("image/") || file.size > 8 * 1024 * 1024)
        return Response.json(
          { error: "書封需為 8MB 以下圖片" },
          { status: 400 },
        );
      const { env } = await import("cloudflare:workers");
      const key = `resources/${resourceId}/cover-${Date.now()}`;
      await env.BUCKET.put(key, file.stream(), {
        httpMetadata: { contentType: file.type },
      });
      if (resource.coverStorageKey)
        await env.BUCKET.delete(resource.coverStorageKey);
      await db
        .update(learningResources)
        .set({ coverStorageKey: key, updatedAt: new Date() })
        .where(eq(learningResources.id, resourceId));
      return Response.json({ ok: true });
    }

    if (assetType === "subtitle") {
      if (
        !file.name.toLowerCase().endsWith(".srt") ||
        file.size > 8 * 1024 * 1024
      )
        return Response.json(
          { error: "請上傳 8MB 以下 SRT 字幕" },
          { status: 400 },
        );
      const lessonLabel = file.name.replace(/\.srt$/i, "");
      const groups = parseSrt(await file.text());
      if (!groups.length)
        return Response.json(
          {
            error:
              "SRT 沒有可辨識的時間碼；請確認格式為 00:00:00,000 --> 00:00:05,000",
          },
          { status: 422 },
        );
      // A course has one authoritative SRT timeline. Remove malformed or
      // previously imported timelines before rebuilding it from this file.
      await db
        .delete(resourceSegments)
        .where(
          and(
            eq(resourceSegments.resourceId, resourceId),
            eq(resourceSegments.segmentType, "subtitle"),
          ),
        );
      const rows = groups.map((group, index) => ({
        resourceId,
        segmentType: "subtitle",
        lessonLabel,
        title: `${Math.floor(group.start / 60)}:${String(group.start % 60).padStart(2, "0")}－${Math.floor(group.end / 60)}:${String(group.end % 60).padStart(2, "0")}`,
        startSeconds: group.start,
        endSeconds: group.end,
        text: group.text,
        sequence: index + 1,
      }));
      for (let index = 0; index < rows.length; index += 8)
        await db.insert(resourceSegments).values(rows.slice(index, index + 8));
      await db
        .update(learningResources)
        .set({ updatedAt: new Date() })
        .where(eq(learningResources.id, resourceId));
      return Response.json({ ok: true, segments: groups.length, lessonLabel });
    }
    return Response.json({ error: "不支援的檔案類型" }, { status: 400 });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error
            ? `SRT 處理失敗：${error.message}`
            : "SRT 處理失敗",
      },
      { status: 500 },
    );
  }
}
