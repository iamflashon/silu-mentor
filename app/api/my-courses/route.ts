import { and, desc, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { myCourses } from "../../../db/schema";
import { fetchYoutubePlaylist, playlistIdFromUrl, videoIdFromUrl } from "../../../lib/youtube-playlist";

function userKey(request: Request) {
  return request.headers.get("oai-authenticated-user-email") ?? "default-owner";
}

function isYoutubeUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && (url.hostname === "youtu.be" || url.hostname === "youtube.com" || url.hostname.endsWith(".youtube.com"));
  } catch {
    return false;
  }
}

function judgeCourse(title: string, subject: string, scope: string) {
  const text = `${title} ${subject} ${scope}`.toLocaleLowerCase("zh-Hant");
  const terms = ["司律", "律師", "司法官", "國考", "考試", "法", "總則", "分則", "債", "物權", "親屬", "繼承", "行政", "憲法", "刑訴", "民訴", "公司", "證券"];
  const hits = terms.filter((term) => text.includes(term)).length;
  const score = Math.min(98, 42 + hits * 10);
  const label = score >= 72 ? "高度相關" : score >= 55 ? "可能相關" : "待確認";
  const reason = label === "高度相關"
    ? `名稱包含「${subject}／${scope}」或國考相關字樣，建議加入後再由你確認課程內容。`
    : label === "可能相關"
      ? "目前只依網址與課程名稱做初步判斷，若是考試課程可以保留。"
      : "名稱缺少明確的考試或法學線索，仍可加入，但請自行確認是否適合司律準備。";
  return { label, score, reason };
}

export async function GET(request: Request) {
  try {
    const db = await getDb();
    const rows = await db.select().from(myCourses).where(eq(myCourses.userKey, userKey(request))).orderBy(desc(myCourses.updatedAt));
    return Response.json({ courses: rows.map((row) => ({ ...row, metadata: JSON.parse(row.metadataJson || "{}") })) });
  } catch {
    return Response.json({ error: "我的課暫時無法讀取" }, { status: 503 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { url?: string; title?: string; subject?: string; examType?: string; scope?: string };
    const sourceUrl = body.url?.trim() ?? "";
    if (!isYoutubeUrl(sourceUrl)) return Response.json({ error: "請貼上有效的 YouTube 影片或播放清單網址" }, { status: 400 });
    const playlistId = playlistIdFromUrl(sourceUrl);
    const videoId = videoIdFromUrl(sourceUrl);
    if (!playlistId && !videoId) return Response.json({ error: "這個網址不是可辨識的 YouTube 影片或播放清單" }, { status: 400 });
    const subject = body.subject?.trim() || "綜合";
    const examType = body.examType?.trim() || "一試／二試";
    const scope = body.scope?.trim() || "全科";
    let itemCount = 0;
    let firstVideoTitle = "";
    if (playlistId) {
      try {
        const items = await fetchYoutubePlaylist(playlistId);
        itemCount = items.length;
        firstVideoTitle = items[0]?.title ?? "";
      } catch {
        return Response.json({ error: "網址有效，但目前讀不到播放清單內容；請確認播放清單是公開的。" }, { status: 502 });
      }
    }
    const title = body.title?.trim() || (playlistId ? `我的${subject}播放清單` : firstVideoTitle || `我的${subject}課程`);
    const judgement = judgeCourse(title, subject, scope);
    const db = await getDb();
    const [course] = await db.insert(myCourses).values({
      userKey: userKey(request), title, sourceUrl, sourceKind: playlistId ? "playlist" : "video", playlistId: playlistId || null, videoId: videoId || null,
      subject, examType, scope, relevanceLabel: judgement.label, relevanceScore: judgement.score,
      metadataJson: JSON.stringify({ itemCount, firstVideoTitle, judgementReason: judgement.reason }),
    }).returning();
    return Response.json({ course: { ...course, metadata: { itemCount, firstVideoTitle, judgementReason: judgement.reason } }, judgement }, { status: 201 });
  } catch (error) {
    console.error("my course create failed", error);
    return Response.json({ error: "目前無法加入我的課，請稍後再試" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const id = Number(new URL(request.url).searchParams.get("id"));
    if (!Number.isInteger(id) || id < 1) return Response.json({ error: "課程編號不正確" }, { status: 400 });
    const db = await getDb();
    await db.delete(myCourses).where(and(eq(myCourses.id, id), eq(myCourses.userKey, userKey(request))));
    return Response.json({ id });
  } catch {
    return Response.json({ error: "無法移除我的課" }, { status: 500 });
  }
}
