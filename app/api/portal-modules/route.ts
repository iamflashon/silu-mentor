import { eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { appSettings } from "../../../db/schema";
import { requireAdmin } from "../../../lib/member-auth";
import { defaultPengliModules, normalizePortalModules } from "../../../lib/portal-modules";

const SETTING_KEY = "portal_modules:pengli:v1";

async function readModules() {
  const db = await getDb();
  const [row] = await db.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, SETTING_KEY)).limit(1);
  try { return normalizePortalModules(row?.value ? JSON.parse(row.value) : defaultPengliModules); } catch { return defaultPengliModules; }
}

export async function GET() { return Response.json({ scope: "pengli", modules: await readModules() }, { headers: { "cache-control": "no-store" } }); }

export async function PATCH(request: Request) {
  const auth = await requireAdmin(request); if ("error" in auth) return auth.error;
  const body = await request.json() as { modules?: unknown };
  const modules = normalizePortalModules(body.modules);
  const db = await getDb();
  await db.insert(appSettings).values({ key: SETTING_KEY, value: JSON.stringify(modules), updatedAt: new Date() }).onConflictDoUpdate({ target: appSettings.key, set: { value: JSON.stringify(modules), updatedAt: new Date() } });
  return Response.json({ scope: "pengli", modules, message: "彭狸模組設定已儲存" });
}
