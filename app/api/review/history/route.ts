import { and, desc, eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { examQuestions, reviewRuns, usageLogs } from "../../../../db/schema";
import { estimateCostUsdMicros } from "../../../../lib/usage";

function userKey(request: Request) {
  return request.headers.get("oai-authenticated-user-email") ?? "default-owner";
}

function asNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function usageTotals(value: unknown) {
  const totals = { inputTokens: 0, cachedTokens: 0, outputTokens: 0, durationMs: 0, estimatedCostUsdMicros: 0 };
  function visit(node: unknown) {
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (!node || typeof node !== "object") return;
    const item = node as Record<string, unknown>;
    totals.inputTokens += asNumber(item.inputTokens);
    totals.cachedTokens += asNumber(item.cachedTokens);
    totals.outputTokens += asNumber(item.outputTokens);
    totals.durationMs += asNumber(item.durationMs);
    const storedCost = asNumber(item.estimatedCostUsdMicros);
    totals.estimatedCostUsdMicros += storedCost || (typeof item.model === "string" && (asNumber(item.inputTokens) > 0 || asNumber(item.outputTokens) > 0)
      ? estimateCostUsdMicros(item.model, { inputTokens: asNumber(item.inputTokens), cachedTokens: asNumber(item.cachedTokens), outputTokens: asNumber(item.outputTokens) })
      : 0);
    Object.values(item).forEach(visit);
  }
  visit(value);
  return totals;
}

export async function GET(request: Request) {
  try {
    const questionId = Number(new URL(request.url).searchParams.get("questionId") || 0);
    const db = await getDb();
    const conditions = questionId > 0
      ? and(eq(reviewRuns.userKey, userKey(request)), eq(reviewRuns.questionId, questionId))
      : eq(reviewRuns.userKey, userKey(request));
    const rows = await db.select({
      id: reviewRuns.id,
      questionId: reviewRuns.questionId,
      participantMode: reviewRuns.participantMode,
      teacherModel: reviewRuns.teacherModel,
      scholarModelsJson: reviewRuns.scholarModelsJson,
      commentatorModel: reviewRuns.commentatorModel,
      stageCount: reviewRuns.stageCount,
      status: reviewRuns.status,
      resultJson: reviewRuns.resultJson,
      inputTokens: reviewRuns.inputTokens,
      cachedTokens: reviewRuns.cachedTokens,
      outputTokens: reviewRuns.outputTokens,
      durationMs: reviewRuns.durationMs,
      createdAt: reviewRuns.createdAt,
      year: examQuestions.year,
      subject: examQuestions.subject,
      questionNumber: examQuestions.questionNumber,
    }).from(reviewRuns)
      .innerJoin(examQuestions, eq(reviewRuns.questionId, examQuestions.id))
      .where(conditions)
      .orderBy(desc(reviewRuns.createdAt))
      .limit(50);
    return Response.json({
      attempts: rows.map((row, index) => ({ ...row, attemptNumber: rows.length - index, scholarModels: safeJson(row.scholarModelsJson, []) })),
    });
  } catch {
    return Response.json({ error: "司律評歷次對話紀錄暫時無法讀取" }, { status: 503 });
  }
}

function safeJson(value: string, fallback: unknown) {
  try { return JSON.parse(value); } catch { return fallback; }
}

function collectUsageRuns(value: unknown) {
  const runs: Array<{ model: string; inputTokens: number; cachedTokens: number; outputTokens: number; estimatedCostUsdMicros?: number }> = [];
  function visit(node: unknown) {
    if (Array.isArray(node)) { node.forEach(visit); return; }
    if (!node || typeof node !== "object") return;
    const item = node as Record<string, unknown>;
    const model = typeof item.model === "string" ? item.model : "";
    const inputTokens = Number(item.inputTokens ?? 0);
    const outputTokens = Number(item.outputTokens ?? 0);
    const cachedTokens = Number(item.cachedTokens ?? 0);
    if (model && (inputTokens > 0 || outputTokens > 0)) {
      runs.push({ model, inputTokens, cachedTokens, outputTokens, estimatedCostUsdMicros: Number(item.estimatedCostUsdMicros ?? 0) || undefined });
    }
    Object.values(item).forEach(visit);
  }
  visit(value);
  return runs;
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as {
      questionId?: number;
      participantMode?: string;
      teacherModel?: string;
      scholarModels?: string[];
      commentatorModel?: string;
      stageCount?: number;
      result?: unknown;
    };
    const questionId = Number(body.questionId || 0);
    if (!questionId || !body.result) return Response.json({ error: "缺少本次對話的完整結果" }, { status: 400 });
    const db = await getDb();
    const question = await db.select({ id: examQuestions.id }).from(examQuestions)
      .where(and(eq(examQuestions.id, questionId), eq(examQuestions.status, "published"))).limit(1);
    if (!question[0]) return Response.json({ error: "找不到可保存的已發布題目" }, { status: 404 });
    const scholarModels = Array.isArray(body.scholarModels) ? body.scholarModels.filter((item) => typeof item === "string").slice(0, 1) : [];
    const totals = usageTotals(body.result);
    const inserted = await db.insert(reviewRuns).values({
      userKey: userKey(request),
      questionId,
      participantMode: body.participantMode === "student-scholar" ? "student-scholar" : "ai-scholar",
      teacherModel: String(body.teacherModel || "luna"),
      scholarModelsJson: JSON.stringify(scholarModels),
      commentatorModel: String(body.commentatorModel || "gpt-5.6-sol"),
      stageCount: Math.max(1, Math.min(3, Number(body.stageCount || 3))),
      status: "completed",
      resultJson: JSON.stringify(body.result),
      ...totals,
    }).returning({ id: reviewRuns.id, createdAt: reviewRuns.createdAt });
    for (const run of collectUsageRuns(body.result)) {
      await db.insert(usageLogs).values({
        model: run.model,
        source: `司律評對話／${run.model}`,
        inputTokens: run.inputTokens,
        cachedTokens: run.cachedTokens,
        outputTokens: run.outputTokens,
        fileSearchCalls: 0,
        estimatedCostUsdMicros: run.estimatedCostUsdMicros ?? estimateCostUsdMicros(run.model, run),
      });
    }
    return Response.json({ ok: true, attempt: inserted[0] });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "司律評紀錄保存失敗" }, { status: 503 });
  }
}
