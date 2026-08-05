import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { getDb } from "../../../db";
import { appSettings, learningResources, listeningAudioSegments, listeningSolutions, listeningSubtitleCues, resourceSegments } from "../../../db/schema";
import { parseMagazineAnalysis } from "../../../lib/magazine";

function magazineSortValue(resource: { title: string; description?: string | null }) {
  const text = `${resource.title} ${resource.description ?? ""}`;
  const issue = Number(text.match(/第\s*(\d+)\s*期/)?.[1] ?? 0);
  const westernYear = Number(text.match(/(?:^|\D)(20\d{2})(?:\D|$)/)?.[1] ?? 0);
  const rocYear = Number(text.match(/(?:民國\s*)?(1\d{2})\s*年/)?.[1] ?? 0);
  const year = westernYear || (rocYear ? rocYear + 1911 : 0);
  return year * 10_000 + issue;
}

export async function GET() {
  const db = await getDb();
  const resources = await db.select().from(learningResources).orderBy(desc(learningResources.updatedAt)).limit(20);
  const listeningCandidates = await db.select({ id: listeningSolutions.id, title: listeningSolutions.title, year: listeningSolutions.year, subject: listeningSolutions.subject, questionText: listeningSolutions.questionText, audioStorageKey: listeningSolutions.audioStorageKey }).from(listeningSolutions).where(eq(listeningSolutions.status, "published")).orderBy(desc(listeningSolutions.updatedAt));
  const listeningItems: Array<{ id: number; title: string; year: string; subject: string; questionText: string; audioStorageKey: string | null; segments: Array<{ id: number; durationSeconds: number; startOffsetSeconds: number; sequence: number }>; subtitles: Array<{ id: number; segmentId: number | null; startSeconds: number; endSeconds: number; text: string; sequence: number }> }> = [];
  for (const candidate of listeningCandidates) {
    const segments = await db.select({ id: listeningAudioSegments.id, durationSeconds: listeningAudioSegments.durationSeconds, startOffsetSeconds: listeningAudioSegments.startOffsetSeconds, sequence: listeningAudioSegments.sequence }).from(listeningAudioSegments).where(eq(listeningAudioSegments.listeningId, candidate.id)).orderBy(asc(listeningAudioSegments.sequence));
    if (candidate.audioStorageKey || segments.length) {
      const subtitles = await db.select({ id: listeningSubtitleCues.id, segmentId: listeningSubtitleCues.segmentId, startSeconds: listeningSubtitleCues.startSeconds, endSeconds: listeningSubtitleCues.endSeconds, text: listeningSubtitleCues.text, sequence: listeningSubtitleCues.sequence }).from(listeningSubtitleCues).where(eq(listeningSubtitleCues.listeningId, candidate.id)).orderBy(asc(listeningSubtitleCues.sequence));
      listeningItems.push({ ...candidate, segments, subtitles });
    }
  }
  const magazines = await db.select().from(learningResources).where(and(eq(learningResources.resourceType, "magazine"), eq(learningResources.status, "active"))).orderBy(desc(learningResources.updatedAt));
  const magazineFeeds = (await Promise.all(magazines.map(async (magazine) => {
    const magazineRows = await db.select({ id: resourceSegments.id, title: resourceSegments.title, summary: resourceSegments.summary, reviewStatus: resourceSegments.reviewStatus, sequence: resourceSegments.sequence }).from(resourceSegments).where(and(eq(resourceSegments.resourceId, magazine.id), inArray(resourceSegments.segmentType, ["article_trial", "article_link", "article"]))).orderBy(asc(resourceSegments.sequence)).limit(4);
    const articles = magazineRows.map((article) => {
      const analysis = parseMagazineAnalysis(article.summary);
      return { ...article, summary: analysis.summary, issue: analysis.issue };
    });
    return { ...magazine, isDraft: false, articles };
  }))).sort((a, b) => magazineSortValue(b) - magazineSortValue(a) || b.id - a.id);
  const recommended = await db.select({ id: resourceSegments.id, resourceId: resourceSegments.resourceId, title: resourceSegments.title, summary: resourceSegments.summary, startSeconds: resourceSegments.startSeconds, importance: resourceSegments.importance }).from(resourceSegments).where(eq(resourceSegments.recommended, true)).orderBy(desc(resourceSegments.importance)).limit(5);
  const settings = await db.select({ key: appSettings.key, value: appSettings.value }).from(appSettings).where(inArray(appSettings.key, ["focus_music_url", "exam_countdowns", "battle_alerts"]));
  const settingValues = Object.fromEntries(settings.map((item) => [item.key, item.value]));
  const parseSetting = <T,>(key: string, fallback: T): T => { try { return settingValues[key] ? JSON.parse(settingValues[key]) as T : fallback; } catch { return fallback; } };
  return Response.json({
    book: resources.find((item) => item.resourceType === "book") ?? null,
    course: resources.find((item) => item.resourceType === "course") ?? null,
    magazines: magazineFeeds,
    magazine: magazineFeeds[0] ?? null,
    listeningItems: listeningItems.map((listening) => ({ id: listening.id, title: listening.title, year: listening.year, subject: listening.subject, questionText: listening.questionText, subtitles: listening.subtitles, audioUrl: listening.audioStorageKey ? `/api/listening/audio?id=${listening.id}` : "", audioSegments: listening.segments.map((segment) => ({ ...segment, audioUrl: `/api/listening/segments/audio?id=${segment.id}` })) })),
    listening: listeningItems[0] ? { id: listeningItems[0].id, title: listeningItems[0].title, year: listeningItems[0].year, subject: listeningItems[0].subject, questionText: listeningItems[0].questionText, subtitles: listeningItems[0].subtitles, audioUrl: listeningItems[0].audioStorageKey ? `/api/listening/audio?id=${listeningItems[0].id}` : "", audioSegments: listeningItems[0].segments.map((segment) => ({ ...segment, audioUrl: `/api/listening/segments/audio?id=${segment.id}` })) } : null,
    focusMusicUrl: settingValues.focus_music_url ?? "",
    recommended,
    ticker: parseSetting<Array<{ id: string; text: string; url: string; enabled: boolean }>>("battle_alerts", []).filter((item) => item.enabled),
    examCountdowns: parseSetting<Array<{ id: string; label: string; date: string; enabled: boolean }>>("exam_countdowns", []).filter((item) => item.enabled),
  });
}
