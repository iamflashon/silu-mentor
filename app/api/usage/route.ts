import { desc, sql } from "drizzle-orm";
import { getDb } from "../../../db";
import { appSettings, usageLogs } from "../../../db/schema";

export async function GET() {
  try {
    const db = await getDb();
    const [totals] = await db.select({
      requests: sql<number>`count(*)`,
      inputTokens: sql<number>`coalesce(sum(${usageLogs.inputTokens}), 0)`,
      cachedTokens: sql<number>`coalesce(sum(${usageLogs.cachedTokens}), 0)`,
      outputTokens: sql<number>`coalesce(sum(${usageLogs.outputTokens}), 0)`,
      fileSearchCalls: sql<number>`coalesce(sum(${usageLogs.fileSearchCalls}), 0)`,
      costMicros: sql<number>`coalesce(sum(${usageLogs.estimatedCostUsdMicros}), 0)`,
    }).from(usageLogs);
    const recent = await db.select().from(usageLogs).orderBy(desc(usageLogs.createdAt)).limit(30);
    const settings = await db.select().from(appSettings);
    const showCosts = settings.find((item) => item.key === "show_frontend_costs")?.value === "true";
    return Response.json({ totals, recent, showCosts });
  } catch {
    return Response.json({ error: "成本資料庫尚未就緒" }, { status: 503 });
  }
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json() as { showCosts?: boolean };
    const db = await getDb();
    await db.insert(appSettings).values({ key: "show_frontend_costs", value: body.showCosts ? "true" : "false" }).onConflictDoUpdate({
      target: appSettings.key,
      set: { value: body.showCosts ? "true" : "false", updatedAt: new Date() },
    });
    return Response.json({ showCosts: Boolean(body.showCosts) });
  } catch {
    return Response.json({ error: "成本顯示設定無法更新" }, { status: 500 });
  }
}
