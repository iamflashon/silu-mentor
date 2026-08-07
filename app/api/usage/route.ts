import { desc, inArray, sql } from "drizzle-orm";
import { getDb } from "../../../db";
import { appSettings, chatComparisonRatings, chatComparisonResponses, chatComparisons, usageLogs } from "../../../db/schema";

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
    const comparisons = await db.select().from(chatComparisons).orderBy(desc(chatComparisons.createdAt)).limit(30);
    const comparisonIds = comparisons.map((item) => item.id);
    const comparisonResponses = comparisonIds.length
      ? await db.select().from(chatComparisonResponses).where(inArray(chatComparisonResponses.comparisonId, comparisonIds)).orderBy(desc(chatComparisonResponses.createdAt))
      : [];
    const comparisonResponseIds = comparisonResponses.map((item) => item.id);
    const comparisonRatings = comparisonResponseIds.length
      ? await db.select().from(chatComparisonRatings).where(inArray(chatComparisonRatings.responseId, comparisonResponseIds)).orderBy(desc(chatComparisonRatings.createdAt))
      : [];
    const preferredRatings = comparisonRatings.filter((item) => item.feedbackType === "preferred");
    const settings = await db.select().from(appSettings);
    const showCosts = settings.find((item) => item.key === "show_frontend_costs")?.value === "true";
    return Response.json({
      totals,
      recent,
      showCosts,
      comparisonStats: {
        comparisons: comparisons.length,
        ratedResponses: comparisonRatings.length,
        lunaPreferred: preferredRatings.filter((rating) => comparisonResponses.find((response) => response.id === rating.responseId)?.provider === "openai").length,
        claudePreferred: preferredRatings.filter((rating) => comparisonResponses.find((response) => response.id === rating.responseId)?.provider === "anthropic").length,
        deepseekPreferred: preferredRatings.filter((rating) => comparisonResponses.find((response) => response.id === rating.responseId)?.provider === "deepseek").length,
        averageScore: comparisonRatings.length
          ? comparisonRatings.reduce((sum, rating) => sum + Number(rating.score || 0), 0) / comparisonRatings.length
          : 0,
      },
      recentComparisons: comparisons.map((comparison) => ({
        id: comparison.id,
        promptText: comparison.promptText,
        sourceStatus: comparison.sourceStatus,
        createdAt: comparison.createdAt,
        responses: comparisonResponses.filter((response) => response.comparisonId === comparison.id).map((response) => ({
          id: response.id,
          label: response.label,
          model: response.model,
          inputTokens: response.inputTokens,
          outputTokens: response.outputTokens,
          estimatedCostUsdMicros: response.estimatedCostUsdMicros,
          durationMs: response.durationMs,
          error: response.error,
          ratings: comparisonRatings.filter((rating) => rating.responseId === response.id).map((rating) => ({ score: rating.score, feedbackType: rating.feedbackType })),
        })),
      })),
    });
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
