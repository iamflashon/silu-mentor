import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { getDb } from "../../../db";
import { appSettings, learningResources, listeningAudioSegments, listeningSolutions, listeningSubtitleCues, resourceSegments } from "../../../db/schema";
import { parseMagazineAnalysis } from "../../../lib/magazine";

export async function GET() {
  const db = await getDb();
  const resources = await db.select().from(learningResources).orderBy(desc(learningResources.updatedAt)).limit(20);
  const listeningCandidates = await db.select({ id: listeningSolutions.id, title: listeningSolutions.title, year: listeningSolutions.year, subject: listeningSolutions.subject, questionText: listeningSolutions.questionText, audioStorageKey: listeningSolutions.audioStorageKey }).from(listeningSolutions).where(eq(listeningSolutions.status, "published")).orderBy(desc(listeningSolutions.updatedAt)).limit(20);
  let listening: { id: number; title: string; year: string; subject: string; questionText: string; audioStorageKey: string | null; segments: Array<{ id: number; durationSeconds: number; startOffsetSeconds: number; sequence: number }>; subtitles: Array<{ id: number; segmentId: number | null; startSeconds: number; endSeconds: number; text: string; sequence: number }> } | null = null;
  for (const candidate of listeningCandidates) {
    const segments = await db.select({ id: listeningAudioSegments.id, durationSeconds: listeningAudioSegments.durationSeconds, startOffsetSeconds: listeningAudioSegments.startOffsetSeconds, sequence: listeningAudioSegments.sequence }).from(listeningAudioSegments).where(eq(listeningAudioSegments.listeningId, candidate.id)).orderBy(asc(listeningAudioSegments.sequence));
    if (candidate.audioStorageKey || segments.length) {
      const subtitles = await db.select({ id: listeningSubtitleCues.id, segmentId: listeningSubtitleCues.segmentId, startSeconds: listeningSubtitleCues.startSeconds, endSeconds: listeningSubtitleCues.endSeconds, text: listeningSubtitleCues.text, sequence: listeningSubtitleCues.sequence }).from(listeningSubtitleCues).where(eq(listeningSubtitleCues.listeningId, candidate.id)).orderBy(asc(listeningSubtitleCues.sequence));
      listening = { ...candidate, segments, subtitles };
      break;
    }
  }
  const magazine = resources.find((item) => item.resourceType === "magazine" && item.status === "active") ?? resources.find((item) => item.resourceType === "magazine") ?? null;
  const magazineIsDraft = Boolean(magazine && magazine.status !== "active");
  const magazineRows = magazine ? await db.select({ id: resourceSegments.id, title: resourceSegments.title, summary: resourceSegments.summary, reviewStatus: resourceSegments.reviewStatus, sequence: resourceSegments.sequence }).from(resourceSegments).where(and(eq(resourceSegments.resourceId, magazine.id), inArray(resourceSegments.segmentType, ["article_trial", "article_link", "article"]))).orderBy(asc(resourceSegments.sequence)).limit(4) : [];
  const magazineArticles = magazineRows.map((article) => {
    const analysis = parseMagazineAnalysis(article.summary);
    return { ...article, summary: analysis.summary, issue: analysis.issue };
  });
  const recommended = await db.select({ id: resourceSegments.id, resourceId: resourceSegments.resourceId, title: resourceSegments.title, summary: resourceSegments.summary, startSeconds: resourceSegments.startSeconds, importance: resourceSegments.importance }).from(resourceSegments).where(eq(resourceSegments.recommended, true)).orderBy(desc(resourceSegments.importance)).limit(5);
  const [musicSetting] = await db.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, "focus_music_url")).limit(1);
  return Response.json({
    book: resources.find((item) => item.resourceType === "book") ?? null,
    course: resources.find((item) => item.resourceType === "course") ?? null,
    magazine: magazine ? { ...magazine, isDraft: magazineIsDraft, articles: magazineArticles } : null,
    listening: listening ? { id: listening.id, title: listening.title, year: listening.year, subject: listening.subject, questionText: listening.questionText, subtitles: listening.subtitles, audioUrl: listening.audioStorageKey ? `/api/listening/audio?id=${listening.id}` : "", audioSegments: listening.segments.map((segment) => ({ ...segment, audioUrl: `/api/listening/segments/audio?id=${segment.id}` })) } : null,
    focusMusicUrl: musicSetting?.value ?? "",
    recommended,
    ticker: ["距離 116 年司律考試持續累積實力", "今日任務完成後，記得留下學習接續點", "每次學習只往前一小步，也是在累積上榜實力"],
  });
}
