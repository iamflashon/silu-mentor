import { and, eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { learningResources, resourceSegments } from "../../../../db/schema";
import { decodeSubtitle, parseSrtCues } from "../../../../lib/srt";

function timeLabel(value: number) {
  const total = Math.max(0, Math.floor(value));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

export async function POST(request: Request) {
  let stage = "讀取上傳檔案";
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
      stage = "辨識 SRT 字幕";
      if (
        !file.name.toLowerCase().endsWith(".srt") ||
        file.size > 8 * 1024 * 1024
      )
        return Response.json(
          { error: "請上傳 8MB 以下 SRT 字幕" },
          { status: 400 },
        );
      const lessonLabel = file.name.replace(/\.srt$/i, "");
      const groups = parseSrtCues(decodeSubtitle(await file.arrayBuffer()));
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
      stage = "清除舊字幕片段";
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
        title: `${timeLabel(group.start)}－${timeLabel(group.end)}`,
        startSeconds: group.start,
        endSeconds: group.end,
        text: group.text,
        reviewStatus: "pending",
        sequence: index + 1,
      }));
      stage = `寫入 ${rows.length} 段字幕片段`;
      // Keep batches small for D1/SQLite bind-variable limits. A long SRT
      // must not fail as one oversized INSERT statement.
      for (let index = 0; index < rows.length; index += 4)
        await db.insert(resourceSegments).values(rows.slice(index, index + 4));
      stage = "更新課程字幕狀態";
      await db
        .update(learningResources)
        .set({ updatedAt: new Date() })
        .where(eq(learningResources.id, resourceId));
      return Response.json({ ok: true, segments: groups.length, lessonLabel });
    }
    return Response.json({ error: "不支援的檔案類型" }, { status: 400 });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "未知錯誤";
    console.error(`[resources/assets] ${stage}: ${detail.slice(0, 500)}`);
    return Response.json(
      {
        error: `字幕${stage}失敗，請按「重新整理字幕」再試一次。`,
        stage,
      },
      { status: 500 },
    );
  }
}
