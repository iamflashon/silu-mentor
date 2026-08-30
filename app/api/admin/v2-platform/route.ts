import { eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { appSettings } from "../../../../db/schema";
import { requireAdmin } from "../../../../lib/member-auth";
import { defaultV2Config, getV2Config, type V2Config } from "../../../../lib/v2-platform";

export async function GET(request: Request) {
  const auth = await requireAdmin(request); if ("error" in auth) return auth.error;
  return Response.json({ config: await getV2Config() }, { headers: { "cache-control": "no-store" } });
}
export async function PATCH(request: Request) {
  const auth = await requireAdmin(request); if ("error" in auth) return auth.error;
  const body = await request.json() as { config?: V2Config };
  if (!body.config?.brands || !body.config.teachers) return Response.json({ error: "設定資料不完整" }, { status: 400 });
  const normalized: V2Config = { ...defaultV2Config, ...body.config };
  const db = await getDb();
  await db.insert(appSettings).values({ key: "v2_platform_config", value: JSON.stringify(normalized), updatedAt: new Date() }).onConflictDoUpdate({ target: appSettings.key, set: { value: JSON.stringify(normalized), updatedAt: new Date() } });
  return Response.json({ config: normalized, message: "V2品牌與模組設定已儲存" });
}
