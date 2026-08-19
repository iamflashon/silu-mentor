import { eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { appSettings } from "../../../../db/schema";

const teachingLevels = new Set(["general", "beginner", "intermediate", "advanced", "super"]);
const modelModes = new Set(["auto", "luna", "sol", "sonnet", "deepseek", "glm", "glm52", "compare-luna-sonnet", "compare-luna-glm52", "compare-luna-deepseek", "compare-sonnet-deepseek", "compare-luna-sonnet-deepseek"]);

function userKey(request: Request) {
  return (request.headers.get("oai-authenticated-user-email") ?? "default-owner").toLowerCase();
}

function settingKey(request: Request) {
  return `home-ai-preferences:${userKey(request)}`;
}

function clean(value: unknown) {
  const row = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    teachingLevel: teachingLevels.has(String(row.teachingLevel)) ? String(row.teachingLevel) : "general",
    modelMode: modelModes.has(String(row.modelMode)) ? String(row.modelMode) : "luna",
    pinned: row.pinned === true,
    collapsed: row.collapsed !== false,
  };
}

export async function GET(request: Request) {
  const db = await getDb();
  const [row] = await db.select().from(appSettings).where(eq(appSettings.key, settingKey(request))).limit(1);
  try {
    return Response.json({ preferences: clean(row ? JSON.parse(row.value) : {}), exists: Boolean(row) });
  } catch {
    return Response.json({ preferences: clean({}), exists: Boolean(row) });
  }
}

export async function PUT(request: Request) {
  const preferences = clean(await request.json().catch(() => ({})));
  const db = await getDb();
  await db.insert(appSettings).values({ key: settingKey(request), value: JSON.stringify(preferences), updatedAt: new Date() }).onConflictDoUpdate({
    target: appSettings.key,
    set: { value: JSON.stringify(preferences), updatedAt: new Date() },
  });
  return Response.json({ preferences, exists: true });
}
