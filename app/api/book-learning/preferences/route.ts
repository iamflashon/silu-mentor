import { and, desc, eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { chatSessions, learningPreferences } from "../../../../db/schema";

const levels = new Set(["beginner", "intermediate", "advanced", "super"]);
const modes = new Set([
  "luna",
  "sonnet",
  "deepseek",
  "compare-luna-sonnet",
  "compare-luna-deepseek",
  "compare-sonnet-deepseek",
  "compare-luna-sonnet-deepseek",
]);

function userKey(request: Request) {
  return request.headers.get("oai-authenticated-user-email") ?? "default-owner";
}

export async function GET(request: Request) {
  const db = await getDb();
  const key = userKey(request);
  const [preference] = await db
    .select()
    .from(learningPreferences)
    .where(eq(learningPreferences.userKey, key))
    .limit(1);
  if (preference) return Response.json({ preference, stored: true });

  const [lastSession] = await db
    .select()
    .from(chatSessions)
    .where(and(eq(chatSessions.userKey, key), eq(chatSessions.contextType, "book")))
    .orderBy(desc(chatSessions.updatedAt))
    .limit(1);
  return Response.json({
    stored: false,
    preference: {
      bookTeachingLevel: null,
      bookModelMode: "luna",
      bookSettingsPinned: false,
      lastBookResourceId: lastSession?.resourceId ?? null,
      lastBookSegmentId: lastSession?.segmentId ?? null,
      lastBookSessionId: lastSession?.id ?? null,
    },
  });
}

export async function PUT(request: Request) {
  const body = await request.json().catch(() => ({})) as {
    bookTeachingLevel?: string | null;
    bookModelMode?: string;
    bookSettingsPinned?: boolean;
    lastBookResourceId?: number | null;
    lastBookSegmentId?: number | null;
    lastBookSessionId?: number | null;
  };
  const db = await getDb();
  const key = userKey(request);
  const [current] = await db.select().from(learningPreferences).where(eq(learningPreferences.userKey, key)).limit(1);
  const values = {
    userKey: key,
    bookTeachingLevel: levels.has(String(body.bookTeachingLevel)) ? String(body.bookTeachingLevel) : body.bookTeachingLevel === null ? null : current?.bookTeachingLevel ?? null,
    bookModelMode: modes.has(String(body.bookModelMode)) ? String(body.bookModelMode) : current?.bookModelMode ?? "luna",
    bookSettingsPinned: typeof body.bookSettingsPinned === "boolean" ? body.bookSettingsPinned : current?.bookSettingsPinned ?? false,
    lastBookResourceId: Number.isInteger(body.lastBookResourceId) ? Number(body.lastBookResourceId) : body.lastBookResourceId === null ? null : current?.lastBookResourceId ?? null,
    lastBookSegmentId: Number.isInteger(body.lastBookSegmentId) ? Number(body.lastBookSegmentId) : body.lastBookSegmentId === null ? null : current?.lastBookSegmentId ?? null,
    lastBookSessionId: Number.isInteger(body.lastBookSessionId) ? Number(body.lastBookSessionId) : body.lastBookSessionId === null ? null : current?.lastBookSessionId ?? null,
    updatedAt: new Date(),
  };
  await db.insert(learningPreferences).values(values).onConflictDoUpdate({
    target: learningPreferences.userKey,
    set: values,
  });
  return Response.json({ preference: values });
}
