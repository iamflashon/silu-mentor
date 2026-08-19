import { eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { appSettings } from "../../../../db/schema";

const basicFields = new Set(["summary", "examFocus", "keyPoints", "issueOutline", "commonMistakes", "sourceNotes", "flashcards"]);
function userKey(request: Request) { return request.headers.get("oai-authenticated-user-email") ?? "default-owner"; }
function settingKey(request: Request) { return `student-summary-preferences:${userKey(request).toLowerCase()}`; }
function clean(value: unknown) {
  const row = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    defaultModel: "luna",
    fields: Array.isArray(row.fields) ? row.fields.map(String).filter((item) => basicFields.has(item)) : [...basicFields],
    customFields: Array.isArray(row.customFields) ? row.customFields.map((item) => String(item).trim().slice(0, 40)).filter(Boolean).slice(0, 3) : [],
  };
}
export async function GET(request: Request) {
  const db = await getDb(); const key = settingKey(request);
  const [row] = await db.select().from(appSettings).where(eq(appSettings.key, key)).limit(1);
  try { return Response.json({ preferences: clean(row ? JSON.parse(row.value) : {}) }); } catch { return Response.json({ preferences: clean({}) }); }
}
export async function PUT(request: Request) {
  const preferences = clean(await request.json().catch(() => ({}))); const db = await getDb(); const key = settingKey(request);
  await db.insert(appSettings).values({ key, value: JSON.stringify(preferences), updatedAt: new Date() }).onConflictDoUpdate({ target: appSettings.key, set: { value: JSON.stringify(preferences), updatedAt: new Date() } });
  return Response.json({ preferences });
}
