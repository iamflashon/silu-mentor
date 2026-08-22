import { desc, inArray, sql } from "drizzle-orm";
import { appSettings, chatComparisonRatings, chatComparisonResponses, chatComparisons, usageLogs } from "../../../db/schema";
import { requireAdmin } from "../../../lib/member-auth";

export async function GET(request: Request) {
  try {
    const auth = await requireAdmin(request);
    if ("error" in auth) return auth.error;
    const db = auth.db;
    // 司律後台的模型與成本頁只呈現司律／共用平台用量。
    // 醫檢功能共用 usage_logs，但其成本由醫檢自己的點數與使用紀錄管理，
    // 因此在此頁排除所有以「醫檢」標記的來源，不刪除原始紀錄。
    const lawUsageWhere = sql`not (${usageLogs.source} like '醫檢%')`;
    const [totals] = await db.select({
      requests: sql<number>`count(*)`,
      inputTokens: sql<number>`coalesce(sum(${usageLogs.inputTokens}), 0)`,
      cachedTokens: sql<number>`coalesce(sum(${usageLogs.cachedTokens}), 0)`,
      outputTokens: sql<number>`coalesce(sum(${usageLogs.outputTokens}), 0)`,
      fileSearchCalls: sql<number>`coalesce(sum(${usageLogs.fileSearchCalls}), 0)`,
      costMicros: sql<number>`coalesce(sum(${usageLogs.estimatedCostUsdMicros}), 0)`,
    }).from(usageLogs).where(lawUsageWhere);
    const recent = await db.select().from(usageLogs).where(lawUsageWhere).orderBy(desc(usageLogs.createdAt)).limit(30);
    // 模型比較是較晚加入的選用功能。舊環境尚未建立比較資料表時，
    // 不應連帶讓既有成本統計與顯示設定整頁失效。
    const comparisons = await db.select().from(chatComparisons).orderBy(desc(chatComparisons.createdAt)).limit(30).catch(() => []);
    const comparisonIds = comparisons.map((item) => item.id);
    const comparisonResponses = comparisonIds.length
      ? await db.select().from(chatComparisonResponses).where(inArray(chatComparisonResponses.comparisonId, comparisonIds)).orderBy(desc(chatComparisonResponses.createdAt)).catch(() => [])
      : [];
    const comparisonResponseIds = comparisonResponses.map((item) => item.id);
    const comparisonRatings = comparisonResponseIds.length
      ? await db.select().from(chatComparisonRatings).where(inArray(chatComparisonRatings.responseId, comparisonResponseIds)).orderBy(desc(chatComparisonRatings.createdAt)).catch(() => [])
      : [];
    const simpleRatings = comparisonRatings.filter((item) => item.feedbackType === "preferred" || item.feedbackType === "rated");
    const preferredRatings = simpleRatings.filter((item) => item.feedbackType === "preferred");
    const settings = await db.select().from(appSettings);
    const showCosts = settings.find((item) => item.key === "show_frontend_costs")?.value === "true";
    const showEvidence = settings.find((item) => item.key === "show_teaching_evidence")?.value === "true";
    const essayGradingDualEnabled = settings.find((item) => item.key === "essay_grading_dual_enabled")?.value === "true";
    return Response.json({
      totals,
      recent,
      showCosts,
      showEvidence,
      essayGradingDualEnabled,
      comparisonStats: {
        comparisons: comparisons.length,
        ratedResponses: simpleRatings.length,
        lunaPreferred: preferredRatings.filter((rating) => comparisonResponses.find((response) => response.id === rating.responseId)?.provider === "openai").length,
        claudePreferred: preferredRatings.filter((rating) => comparisonResponses.find((response) => response.id === rating.responseId)?.provider === "anthropic").length,
        deepseekPreferred: preferredRatings.filter((rating) => comparisonResponses.find((response) => response.id === rating.responseId)?.provider === "deepseek").length,
        averageScore: simpleRatings.length
          ? simpleRatings.reduce((sum, rating) => sum + Number(rating.score || 0), 0) / simpleRatings.length
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
    const body = await request.json() as { showCosts?: boolean; showEvidence?: boolean; essayGradingDualEnabled?: boolean };
    const auth = await requireAdmin(request);
    if ("error" in auth) return auth.error;
    const db = auth.db;
    if (typeof body.showCosts === "boolean") await db.insert(appSettings).values({ key: "show_frontend_costs", value: body.showCosts ? "true" : "false" }).onConflictDoUpdate({ target: appSettings.key, set: { value: body.showCosts ? "true" : "false", updatedAt: new Date() } });
    if (typeof body.showEvidence === "boolean") await db.insert(appSettings).values({ key: "show_teaching_evidence", value: body.showEvidence ? "true" : "false" }).onConflictDoUpdate({ target: appSettings.key, set: { value: body.showEvidence ? "true" : "false", updatedAt: new Date() } });
    if (typeof body.essayGradingDualEnabled === "boolean") await db.insert(appSettings).values({ key: "essay_grading_dual_enabled", value: body.essayGradingDualEnabled ? "true" : "false" }).onConflictDoUpdate({ target: appSettings.key, set: { value: body.essayGradingDualEnabled ? "true" : "false", updatedAt: new Date() } });
    const settings = await db.select().from(appSettings);
    return Response.json({
      showCosts: settings.find((item) => item.key === "show_frontend_costs")?.value === "true",
      showEvidence: settings.find((item) => item.key === "show_teaching_evidence")?.value === "true",
      essayGradingDualEnabled: settings.find((item) => item.key === "essay_grading_dual_enabled")?.value === "true",
    });
  } catch {
    return Response.json({ error: "成本顯示設定無法更新" }, { status: 500 });
  }
}
