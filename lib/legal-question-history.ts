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

export async function recordLegalResearchRun(memberId: number, question: string, persona: string, source: string, result: Record<string, unknown>, status: "completed" | "failed" = "completed", errorMessage = "") {
  const db = await database();
  await ensureQuestionTable(db);
  const researcher = result.researcher && typeof result.researcher === "object" ? result.researcher as Record<string, unknown> : {};
  const usage = result.tokenUsage && typeof result.tokenUsage === "object" ? result.tokenUsage as Record<string, unknown> : {};
  await db.prepare(`INSERT INTO legal_search_runs
    (member_id,persona,question,normalized_question,source,result_json,planner,direct_evidence_count,total_unique_cases,internal_tokens,estimated_cost_usd,searchable_cases,reusable,status,error_message,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(
      memberId, persona.slice(0, 30), question.slice(0, 240), normalizeLegalQuestion(question), source === "persona" ? "persona" : "custom",
      JSON.stringify(result), typeof researcher.planner === "string" ? researcher.planner : "", Number(result.directEvidenceCount) || 0,
      Number(result.totalUniqueCases) || 0, Number(usage.internalTotalTokens) || 0, Number(usage.internalEstimatedCostUsd) || 0,
      Number(result.cloudAvailableTotal) || 0, source === "persona" && status === "completed" ? 1 : 0, status, errorMessage.slice(0, 300), Date.now(),
    ).run();
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
  const history = await db.prepare("SELECT question,persona,source,asked_count AS askedCount,last_asked_at AS lastAskedAt FROM legal_search_questions WHERE member_id=? ORDER BY last_asked_at DESC LIMIT 12")
    .bind(memberId).all<{ question: string; persona: string; source: string; askedCount: number; lastAskedAt: number }>();
  const common = await db.prepare("SELECT question,SUM(asked_count) AS askedCount,MAX(last_asked_at) AS lastAskedAt FROM legal_search_questions WHERE source='persona' GROUP BY normalized_question ORDER BY askedCount DESC,lastAskedAt DESC LIMIT 10")
    .bind().all<{ question: string; askedCount: number; lastAskedAt: number }>();
  const fallback = LEGAL_QUESTION_BANK.litigator.slice(0, 4).map((question) => ({ question, askedCount: 0, lastAskedAt: 0 }));
  const runs = await db.prepare("SELECT COUNT(*) AS value FROM legal_search_runs WHERE member_id=?").bind(memberId).all<{ value: number }>();
  return { history: history.results ?? [], common: common.results?.length ? common.results : fallback, bankSize: Object.values(LEGAL_QUESTION_BANK).reduce((sum, items) => sum + items.length, 0), savedResearchRuns: Number(runs.results?.[0]?.value ?? 0) };
}
