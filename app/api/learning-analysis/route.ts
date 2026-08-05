import { and, asc, desc, eq, or } from "drizzle-orm";
import { getDb } from "../../../db";
import { learningAnalyses, learningResources, resourceSegments, studyPlans, studyRecords, studyTasks, usageLogs } from "../../../db/schema";
import { getOpenAIKey, getOpenAIModel, openAIJson } from "../../../lib/openai";
import { taipeiDate } from "../../../lib/taipei-time";

type RecordRow = typeof studyRecords.$inferSelect;
type Recommendation = { title: string; type: string; reason: string; action: string; resourceId: number | null; segmentId: number | null; url: string; location: string };
type AnalysisResult = {
  statusLabel: string;
  summary: string;
  strengths: string[];
  gaps: string[];
  nextAction: string;
  recommendations: Recommendation[];
  model: string;
  usage: { inputTokens: number; outputTokens: number; estimatedCostUsd: number };
  generatedAt: string;
  saved?: boolean;
  isStale?: boolean;
};

function userKey(request: Request) {
  return request.headers.get("oai-authenticated-user-email") ?? "default-owner";
}

function outputText(payload: Record<string, unknown>) {
  return (Array.isArray(payload.output) ? payload.output : []).flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    return (Array.isArray((item as { content?: unknown[] }).content) ? (item as { content: unknown[] }).content : [])
      .map((part) => part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string" ? (part as { text: string }).text : "");
  }).join("").trim();
}

function countWeaknesses(records: RecordRow[]) {
  const counts = new Map<string, number>();
  for (const record of records) {
    const weakness = record.weakness.trim();
    if (weakness) counts.set(weakness, (counts.get(weakness) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
}

function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function sourceFingerprint(records: RecordRow[]) {
  return { count: records.length, latestId: records[0]?.id ?? 0 };
}

async function saveAnalysis(db: Awaited<ReturnType<typeof getDb>>, key: string, analysis: Omit<AnalysisResult, "generatedAt" | "saved" | "isStale">, records: RecordRow[]) {
  const fingerprint = sourceFingerprint(records);
  const generatedAt = new Date();
  await db.insert(learningAnalyses).values({
    userKey: key,
    sourceRecordCount: fingerprint.count,
    sourceLatestRecordId: fingerprint.latestId,
    statusLabel: analysis.statusLabel,
    summary: analysis.summary,
    strengthsJson: JSON.stringify(analysis.strengths),
    gapsJson: JSON.stringify(analysis.gaps),
    nextAction: analysis.nextAction,
    recommendationsJson: JSON.stringify(analysis.recommendations),
    model: analysis.model,
    inputTokens: analysis.usage.inputTokens,
    outputTokens: analysis.usage.outputTokens,
    estimatedCostUsdMicros: Math.round(analysis.usage.estimatedCostUsd * 1_000_000),
    generatedAt,
    createdAt: generatedAt,
  });
  return { ...analysis, generatedAt: taipeiDate(generatedAt), saved: true, isStale: false } satisfies AnalysisResult;
}

function rowToAnalysis(row: typeof learningAnalyses.$inferSelect, currentRecords: RecordRow[]): AnalysisResult {
  const fingerprint = sourceFingerprint(currentRecords);
  return {
    statusLabel: row.statusLabel,
    summary: row.summary,
    strengths: parseJson<string[]>(row.strengthsJson, []),
    gaps: parseJson<string[]>(row.gapsJson, []),
    nextAction: row.nextAction,
    recommendations: parseJson<Recommendation[]>(row.recommendationsJson, []),
    model: row.model,
    usage: { inputTokens: row.inputTokens, outputTokens: row.outputTokens, estimatedCostUsd: row.estimatedCostUsdMicros / 1_000_000 },
    generatedAt: taipeiDate(row.generatedAt),
    saved: true,
    isStale: row.sourceRecordCount !== fingerprint.count || row.sourceLatestRecordId !== fingerprint.latestId,
  };
}

function fallbackAnalysis(records: RecordRow[], pendingTasks: number, candidates: Array<{ resourceId: number; segmentId: number; title: string; resourceType: string; lessonLabel: string; pageStart: number | null; pageEnd: number | null; sourceUrl: string }>) {
  const answered = records.filter((record) => record.correct !== null);
  const correct = answered.filter((record) => record.correct).length;
  const minutes = records.reduce((sum, record) => sum + record.actualMinutes, 0);
  const accuracy = answered.length ? Math.round((correct / answered.length) * 100) : null;
  const weaknesses = countWeaknesses(records);
  const primary = weaknesses[0]?.[0] ?? (answered.length && accuracy !== null && accuracy < 70 ? "選項判斷與錯因整理" : "尚未形成穩定弱點樣本");
  const status = !records.length ? "尚在建立學習樣本" : accuracy !== null && accuracy < 70 ? "需要先補核心觀念" : accuracy !== null && accuracy >= 80 ? "基礎穩定，應增加涵攝與變化題" : "正在累積，下一步要加強回想";
  const recommendation = candidates.slice(0, 3).map((candidate, index) => ({
    title: candidate.title,
    type: candidate.resourceType === "course" ? "影音課" : "智能書",
    reason: index === 0 ? `與目前最需要處理的「${primary}」最接近` : "作為間隔複習，避免只停留在單次閱讀",
    action: index === 0 ? "先讀這一段，再用一句話說出判斷規則" : "完成後閉上教材，口頭回想三個關鍵點",
    resourceId: candidate.resourceId,
    segmentId: candidate.segmentId,
    url: candidate.sourceUrl,
    location: [candidate.lessonLabel, candidate.pageStart ? `第 ${candidate.pageStart}${candidate.pageEnd && candidate.pageEnd !== candidate.pageStart ? `–${candidate.pageEnd}` : ""} 頁` : ""].filter(Boolean).join(" · "),
  }));
  return {
    statusLabel: status,
    summary: !records.length ? "目前紀錄還少，先完成幾次學習與作答，AI 教練才能辨認出穩定弱點。" : `最近累積 ${minutes} 分鐘學習${answered.length ? `，作答正確率 ${accuracy}%` : "，目前以閱讀與對話為主"}。教練建議先處理「${primary}」，再用一題回想確認是否真的補起來。`,
    strengths: records.length ? ["有留下可追蹤的學習紀錄", minutes >= 120 ? "投入時間已形成穩定節奏" : "已開始累積學習節奏"] : ["已進入學習專區", "接下來可用紀錄讓教練更精準"],
    gaps: weaknesses.length ? weaknesses.map(([topic, count]) => `${topic}（${count} 次被記錄）`) : ["尚未有足夠的弱點紀錄", pendingTasks ? `仍有 ${pendingTasks} 項計畫任務待完成` : "尚未有足夠的作答樣本"],
    nextAction: recommendation[0]?.action ?? "今天先完成一題真題，並寫下錯在何處；教練會依結果更新診斷。",
    recommendations: recommendation,
    model: "規則初判",
    usage: { inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0 },
  };
}

export async function POST(request: Request) {
  try {
    const db = await getDb();
    const key = userKey(request);
    const records = await db.select().from(studyRecords).where(eq(studyRecords.userKey, key)).orderBy(desc(studyRecords.createdAt)).limit(80);
    const [plan] = await db.select().from(studyPlans).where(eq(studyPlans.active, true)).limit(1);
    const tasks = plan ? await db.select().from(studyTasks).where(and(eq(studyTasks.planId, plan.id), eq(studyTasks.status, "pending"))).orderBy(asc(studyTasks.taskDate)).limit(12) : [];
    const subjects = [...new Set(records.map((record) => record.subject).filter(Boolean))];
    const candidateRows = await db.select({ resourceId: learningResources.id, segmentId: resourceSegments.id, title: resourceSegments.title, resourceType: learningResources.resourceType, lessonLabel: resourceSegments.lessonLabel, pageStart: resourceSegments.pageStart, pageEnd: resourceSegments.pageEnd, sourceUrl: learningResources.sourceUrl }).from(resourceSegments).innerJoin(learningResources, eq(resourceSegments.resourceId, learningResources.id)).where(and(eq(learningResources.status, "active"), subjects.length ? or(...subjects.map((subject) => or(eq(learningResources.subject, subject), eq(learningResources.subject, "綜合")))) : eq(learningResources.status, "active"))).orderBy(desc(resourceSegments.recommended), desc(resourceSegments.importance)).limit(16);
    const fallback = fallbackAnalysis(records, tasks.length, candidateRows);
    if (!(await getOpenAIKey())) return Response.json(await saveAnalysis(db, key, fallback, records));

    const weaknessSummary = countWeaknesses(records).map(([topic, count]) => `${topic}（${count}次）`).join("、") || "尚無明確弱點";
    const recordSummary = records.slice(0, 45).map((record) => `${record.recordDate}|${record.subject}|${record.activityType}|${record.title}|${record.actualMinutes}分|${record.correct === null ? "未作答" : record.correct ? "答對" : "答錯"}|弱點:${record.weakness || "無"}|接續:${record.nextStep || "無"}`).join("\n");
    const candidateSummary = candidateRows.map((item) => `ID:${item.segmentId}|${item.resourceType}|${item.title}|${item.lessonLabel}|${item.sourceUrl || ""}`).join("\n");
    const model = await getOpenAIModel("gpt-5.6-luna");
    const payload = await openAIJson("/responses", { method: "POST", body: JSON.stringify({
      model,
      instructions: "你是台灣司律考試的 AI 學習教練。你要診斷學習行為與作答紀錄，不是稱讚使用者，也不是把紀錄重新抄一遍。請指出目前學習狀況、已掌握處、最值得補強的缺口，並給一個今天能執行的下一步。只能依提供的紀錄與教材候選判斷；不可以捏造未出現的學習內容。若資料不足，明確說明『樣本仍不足』，不要裝作已經診斷完成。回覆繁體中文、具體、鼓勵但不空泛；不得使用 Markdown 星號。recommendations 只能選教材候選中的 ID，沒有合適候選就回傳空陣列。",
      input: `今天：${taipeiDate()}\n目前計畫：${plan?.targetLabel || "尚未設定"}；待完成任務：${tasks.length} 項\n弱點統計：${weaknessSummary}\n學習紀錄：\n${recordSummary || "尚無紀錄"}\n\n可推薦教材候選：\n${candidateSummary || "尚無可用候選"}`,
      text: { format: { type: "json_schema", name: "learning_coach_analysis", strict: true, schema: { type: "object", additionalProperties: false, properties: { status_label: { type: "string" }, summary: { type: "string" }, strengths: { type: "array", items: { type: "string" } }, gaps: { type: "array", items: { type: "string" } }, next_action: { type: "string" }, recommended_segment_ids: { type: "array", items: { type: "integer" } } }, required: ["status_label", "summary", "strengths", "gaps", "next_action", "recommended_segment_ids"] } } },
    }) });
    const parsed = JSON.parse(outputText(payload)) as { status_label: string; summary: string; strengths: string[]; gaps: string[]; next_action: string; recommended_segment_ids: number[] };
    const selected = candidateRows.filter((item) => parsed.recommended_segment_ids.includes(item.segmentId)).slice(0, 4);
    const recommendations: Recommendation[] = selected.map((item, index) => ({ title: item.title, type: item.resourceType === "course" ? "影音課" : "智能書", reason: index === 0 ? "依目前弱點與學習紀錄優先推薦" : "作為間隔複習與交叉確認", action: index === 0 ? "先閱讀或觀看，再用一句話回想核心規則" : "完成後離開教材，口頭說出一個例外或判斷分岔", resourceId: item.resourceId, segmentId: item.segmentId, url: item.sourceUrl, location: [item.lessonLabel, item.pageStart ? `第 ${item.pageStart}${item.pageEnd && item.pageEnd !== item.pageStart ? `–${item.pageEnd}` : ""} 頁` : ""].filter(Boolean).join(" · ") }));
    const usage = payload.usage as { input_tokens?: number; output_tokens?: number; input_tokens_details?: { cached_tokens?: number } } | undefined;
    const inputTokens = Number(usage?.input_tokens ?? 0);
    const outputTokens = Number(usage?.output_tokens ?? 0);
    await db.insert(usageLogs).values({ model: String(payload.model ?? model), source: "學習紀錄 AI 教練診斷", inputTokens, cachedTokens: Number(usage?.input_tokens_details?.cached_tokens ?? 0), outputTokens, fileSearchCalls: 0, estimatedCostUsdMicros: 0 });
    return Response.json(await saveAnalysis(db, key, { statusLabel: parsed.status_label, summary: parsed.summary, strengths: parsed.strengths.slice(0, 4), gaps: parsed.gaps.slice(0, 4), nextAction: parsed.next_action, recommendations, model: String(payload.model ?? model), usage: { inputTokens, outputTokens, estimatedCostUsd: 0 } }, records));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message.slice(0, 240) : "AI 教練診斷暫時無法完成" }, { status: 500 });
  }
}

export async function GET(request: Request) {
  try {
    const db = await getDb();
    const key = userKey(request);
    const records = await db.select().from(studyRecords).where(eq(studyRecords.userKey, key)).orderBy(desc(studyRecords.createdAt)).limit(80);
    const [row] = await db.select().from(learningAnalyses).where(eq(learningAnalyses.userKey, key)).orderBy(desc(learningAnalyses.generatedAt)).limit(1);
    return Response.json({ analysis: row ? rowToAnalysis(row, records) : null });
  } catch {
    return Response.json({ analysis: null, error: "已保存的 AI 診斷暫時無法讀取" }, { status: 503 });
  }
}
