import { LEGAL_QUESTION_BANK, type LegalQuestionPersona } from "./legal-question-bank";

type D1DatabaseLike = { prepare(query: string): { bind(...values: unknown[]): { run(): Promise<unknown>; all<T>(): Promise<{ results?: T[] }> } } };

async function database() {
  const { env } = await import("cloudflare:workers");
  return env.DB as unknown as D1DatabaseLike;
}

async function ensureQuestionTable(db: D1DatabaseLike) {
  await db.prepare(`CREATE TABLE IF NOT EXISTS legal_search_questions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    member_id INTEGER NOT NULL,
    persona TEXT NOT NULL DEFAULT '',
    question TEXT NOT NULL,
    normalized_question TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'custom',
    asked_count INTEGER NOT NULL DEFAULT 1,
    first_asked_at INTEGER NOT NULL,
    last_asked_at INTEGER NOT NULL,
    UNIQUE(member_id, normalized_question)
  )`).bind().run();
  await db.prepare("CREATE INDEX IF NOT EXISTS legal_search_questions_member_time_idx ON legal_search_questions(member_id,last_asked_at DESC)").bind().run();
  await db.prepare("CREATE INDEX IF NOT EXISTS legal_search_questions_source_count_idx ON legal_search_questions(source,asked_count DESC)").bind().run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS legal_search_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    member_id INTEGER NOT NULL,
    persona TEXT NOT NULL DEFAULT '',
    question TEXT NOT NULL,
    normalized_question TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'custom',
    result_json TEXT NOT NULL,
    planner TEXT NOT NULL DEFAULT '',
    direct_evidence_count INTEGER NOT NULL DEFAULT 0,
    total_unique_cases INTEGER NOT NULL DEFAULT 0,
    internal_tokens INTEGER NOT NULL DEFAULT 0,
    estimated_cost_usd TEXT NOT NULL DEFAULT '0',
    searchable_cases INTEGER NOT NULL DEFAULT 0,
    reusable INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'completed',
    error_message TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL
  )`).bind().run();
  await db.prepare("CREATE INDEX IF NOT EXISTS legal_search_runs_question_time_idx ON legal_search_runs(normalized_question,created_at DESC)").bind().run();
  await db.prepare("CREATE INDEX IF NOT EXISTS legal_search_runs_member_time_idx ON legal_search_runs(member_id,created_at DESC)").bind().run();
}

function countQueryRuns(result: Record<string, unknown>) {
  if (!Array.isArray(result.rounds)) return 0;
  return result.rounds.reduce((sum, round) => sum + (round && typeof round === "object" && Array.isArray((round as Record<string, unknown>).queryRuns) ? ((round as Record<string, unknown>).queryRuns as unknown[]).length : 0), 0);
}

export function buildLegalResearchReview(result: Record<string, unknown>, status = "completed", errorMessage = "") {
  const researcher = result.researcher && typeof result.researcher === "object" ? result.researcher as Record<string, unknown> : {};
  const directEvidence = Number(result.directEvidenceCount ?? result.qualifiedCases) || 0;
  const indirectEvidence = Number(result.indirectEvidenceCount) || (Array.isArray(result.exploratoryCandidates) ? result.exploratoryCandidates.length : 0);
  const uniqueCases = Number(result.totalUniqueCases) || 0;
  const queryRuns = countQueryRuns(result);
  const planner = typeof researcher.planner === "string" ? researcher.planner : "unknown";
  const suggestions: string[] = [];
  if (status !== "completed") suggestions.push(`本次研究未完成：${errorMessage || "需檢查執行紀錄與服務狀態"}`);
  if (planner !== "sol") suggestions.push("Sol 未正常介入，應檢查模型連線、逾時或額度，避免只依固定規則拆解問題。");
  if (queryRuns < 4) suggestions.push("實際查詢組合偏少，建議增加裁判常用語、同義詞與程序案號的交叉查詢。");
  if (uniqueCases === 0) suggestions.push("沒有取得候選裁判，應確認資料涵蓋量、索引狀態與搜尋詞是否過度嚴格。");
  if (uniqueCases > 0 && directEvidence === 0) suggestions.push("有候選裁判但沒有直接證據，應強化程序事實、案號字別與全文必要語句的檢索。");
  if (indirectEvidence > directEvidence && indirectEvidence >= 3) suggestions.push("間接候選多於直接證據，應新增假命中排除規則，避免關鍵字共現被誤判為案件事實。");
  if (directEvidence > 0 && suggestions.length === 0) suggestions.push("本次已取得直接證據；下一步應核對代表性、裁判層級及新舊見解，確認可穩定重現結果。");
  const score = Math.max(0, Math.min(100, (status === "completed" ? 30 : 0) + (planner === "sol" ? 20 : 0) + Math.min(20, queryRuns * 3) + Math.min(20, directEvidence * 5) + (uniqueCases > 0 ? 10 : 0) - Math.min(15, Math.max(0, indirectEvidence - directEvidence) * 2)));
  return { score, status: score >= 80 ? "良好" : score >= 60 ? "可用但需調整" : "需要改進", planner, queryRuns, directEvidence, indirectEvidence, uniqueCases, suggestions };
}

export async function recordLegalResearchRun(memberId: number, question: string, persona: string, source: string, result: Record<string, unknown>, status: "completed" | "failed" = "completed", errorMessage = "") {
  const db = await database();
  await ensureQuestionTable(db);
  const researcher = result.researcher && typeof result.researcher === "object" ? result.researcher as Record<string, unknown> : {};
  const usage = result.tokenUsage && typeof result.tokenUsage === "object" ? result.tokenUsage as Record<string, unknown> : {};
  const savedResult = { ...result, improvementReview: buildLegalResearchReview(result, status, errorMessage) };
  await db.prepare(`INSERT INTO legal_search_runs
    (member_id,persona,question,normalized_question,source,result_json,planner,direct_evidence_count,total_unique_cases,internal_tokens,estimated_cost_usd,searchable_cases,reusable,status,error_message,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(
      memberId, persona.slice(0, 30), question.slice(0, 240), normalizeLegalQuestion(question), source === "persona" ? "persona" : "custom",
      JSON.stringify(savedResult), typeof researcher.planner === "string" ? researcher.planner : "", Number(result.directEvidenceCount ?? result.qualifiedCases) || 0,
      Number(result.totalUniqueCases) || 0, Number(usage.internalTotalTokens) || 0, Number(usage.internalEstimatedCostUsd) || 0,
      Number(result.cloudAvailableTotal) || 0, source === "persona" && status === "completed" ? 1 : 0, status, errorMessage.slice(0, 300), Date.now(),
    ).run();
  return savedResult;
}

export function normalizeLegalQuestion(question: string) {
  return question.trim().replace(/\s+/g, " ").replace(/[?？]+$/, "？").slice(0, 240);
}

export async function recordLegalQuestion(memberId: number, question: string, persona = "", source = "custom") {
  const db = await database();
  await ensureQuestionTable(db);
  const normalized = normalizeLegalQuestion(question);
  const now = Date.now();
  await db.prepare(`INSERT INTO legal_search_questions (member_id,persona,question,normalized_question,source,asked_count,first_asked_at,last_asked_at)
    VALUES (?,?,?,?,?,1,?,?) ON CONFLICT(member_id,normalized_question) DO UPDATE SET
    asked_count=asked_count+1,last_asked_at=excluded.last_asked_at,
    persona=CASE WHEN excluded.persona<>'' THEN excluded.persona ELSE persona END,
    source=CASE WHEN source='persona' THEN source ELSE excluded.source END`)
    .bind(memberId, persona, question.slice(0, 240), normalized, source === "persona" ? "persona" : "custom", now, now).run();
}

export async function nextUnaskedQuestion(memberId: number, persona: LegalQuestionPersona, excludedQuestions: string[] = []) {
  const db = await database();
  await ensureQuestionTable(db);
  const rows = await db.prepare("SELECT normalized_question AS question FROM legal_search_questions WHERE member_id=? AND persona=?")
    .bind(memberId, persona).all<{ question: string }>();
  const asked = new Set((rows.results ?? []).map((row) => row.question));
  const excluded = new Set(excludedQuestions.map(normalizeLegalQuestion));
  const bank = [...LEGAL_QUESTION_BANK[persona]];
  const next = bank.find((question) => !asked.has(normalizeLegalQuestion(question)) && !excluded.has(normalizeLegalQuestion(question)));
  if (next) return { question: next, remaining: Math.max(0, bank.length - asked.size - 1), cycleRestarted: false };
  const unseenDisplayed = bank.find((question) => !excluded.has(normalizeLegalQuestion(question)));
  if (unseenDisplayed) return { question: unseenDisplayed, remaining: 0, cycleRestarted: true };
  const history = await db.prepare("SELECT normalized_question AS question FROM legal_search_questions WHERE member_id=? AND persona=? ORDER BY last_asked_at ASC LIMIT 1")
    .bind(memberId, persona).all<{ question: string }>();
  const oldest = history.results?.[0]?.question;
  return { question: bank.find((item) => normalizeLegalQuestion(item) === oldest) ?? bank[0], remaining: 0, cycleRestarted: true };
}

export async function legalQuestionHistory(memberId: number) {
  const db = await database();
  await ensureQuestionTable(db);
  const history = await db.prepare("SELECT id AS runId,question,persona,source,status,created_at AS lastAskedAt FROM legal_search_runs WHERE member_id=? ORDER BY created_at DESC LIMIT 30")
    .bind(memberId).all<{ runId: number; question: string; persona: string; source: string; status: string; lastAskedAt: number }>();
  const common = await db.prepare("SELECT question,SUM(asked_count) AS askedCount,MAX(last_asked_at) AS lastAskedAt FROM legal_search_questions WHERE source='persona' GROUP BY normalized_question ORDER BY askedCount DESC,lastAskedAt DESC LIMIT 10")
    .bind().all<{ question: string; askedCount: number; lastAskedAt: number }>();
  const fallback = LEGAL_QUESTION_BANK.litigator.slice(0, 4).map((question) => ({ question, askedCount: 0, lastAskedAt: 0 }));
  const runs = await db.prepare("SELECT COUNT(*) AS value FROM legal_search_runs WHERE member_id=?").bind(memberId).all<{ value: number }>();
  return { history: history.results ?? [], common: common.results?.length ? common.results : fallback, bankSize: Object.values(LEGAL_QUESTION_BANK).reduce((sum, items) => sum + items.length, 0), savedResearchRuns: Number(runs.results?.[0]?.value ?? 0) };
}

export async function legalResearchRunDetail(memberId: number, runId: number) {
  const db = await database();
  await ensureQuestionTable(db);
  const rows = await db.prepare("SELECT id,question,normalized_question AS normalizedQuestion,persona,source,status,error_message AS errorMessage,created_at AS createdAt,result_json AS resultJson FROM legal_search_runs WHERE id=? AND member_id=? LIMIT 1")
    .bind(runId, memberId).all<{ id: number; question: string; normalizedQuestion: string; persona: string; source: string; status: string; errorMessage: string; createdAt: number; resultJson: string }>();
  const row = rows.results?.[0];
  if (!row) return null;
  let result: Record<string, unknown> = {};
  try { result = JSON.parse(row.resultJson) as Record<string, unknown>; } catch { result = {}; }
  if (!result.improvementReview) result.improvementReview = buildLegalResearchReview(result, row.status, row.errorMessage);
  const previousRows = await db.prepare("SELECT id,created_at AS createdAt,result_json AS resultJson,status,error_message AS errorMessage FROM legal_search_runs WHERE member_id=? AND normalized_question=? AND created_at<? ORDER BY created_at DESC LIMIT 1")
    .bind(memberId, row.normalizedQuestion, row.createdAt).all<{ id: number; createdAt: number; resultJson: string; status: string; errorMessage: string }>();
  const previous = previousRows.results?.[0];
  if (previous) {
    let previousResult: Record<string, unknown> = {};
    try { previousResult = JSON.parse(previous.resultJson) as Record<string, unknown>; } catch { previousResult = {}; }
    const currentReview = result.improvementReview as ReturnType<typeof buildLegalResearchReview>;
    const previousReview = previousResult.improvementReview && typeof previousResult.improvementReview === "object" ? previousResult.improvementReview as ReturnType<typeof buildLegalResearchReview> : buildLegalResearchReview(previousResult, previous.status, previous.errorMessage);
    result.improvementComparison = { previousRunId: previous.id, previousCreatedAt: previous.createdAt, scoreDelta: currentReview.score - previousReview.score, directEvidenceDelta: currentReview.directEvidence - previousReview.directEvidence, indirectEvidenceDelta: currentReview.indirectEvidence - previousReview.indirectEvidence, uniqueCasesDelta: currentReview.uniqueCases - previousReview.uniqueCases, queryRunsDelta: currentReview.queryRuns - previousReview.queryRuns };
  }
  return { id: row.id, question: row.question, persona: row.persona, source: row.source, status: row.status, errorMessage: row.errorMessage, createdAt: row.createdAt, result };
}
