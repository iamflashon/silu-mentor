type SavePayload = {
  action?: "save" | "alert";
  memberEmail?: string;
  caseRecord?: {
    id?: string;
    title?: string;
    originalQuestion?: string;
    facts?: unknown[];
    finalConclusion?: string;
    status?: string;
  };
  messages?: Array<{ id?: string; role?: string; content?: unknown; createdAt?: number }>;
  sources?: Array<{
    id?: string;
    sourceType?: string;
    externalId?: string;
    title?: string;
    metadata?: unknown;
    quote?: string;
    aiSummary?: string;
    sourceUrl?: string;
    fullText?: string;
    fullTextRead?: boolean;
  }>;
  alerts?: Array<{
    id?: string;
    code?: string;
    severity?: string;
    title?: string;
    message?: string;
    status?: string;
  }>;
  searches?: Array<{
    id?: string;
    source?: string;
    query?: string;
    status?: string;
    resultCount?: number;
  }>;
  charge?: { id?: string; scopeHash?: string; units?: number; description?: string };
  alertId?: string;
  alertStatus?: string;
};
type ResearchStatement = {
  bind: (...values: unknown[]) => ResearchStatement;
  first: <T = Record<string, unknown>>() => Promise<T | null>;
  all: () => Promise<{ results?: Array<Record<string, unknown>> }>;
  run: () => Promise<{ meta: { changes?: number } }>;
};
type ResearchDatabase = {
  prepare: (sql: string) => ResearchStatement;
  batch: (statements: ResearchStatement[]) => Promise<unknown>;
};
const clean = (value: unknown, max: number) =>
  typeof value === "string" ? value.trim().slice(0, max) : "";
const json = (value: unknown, fallback: unknown) => {
  try {
    return JSON.stringify(value ?? fallback).slice(0, 250_000);
  } catch {
    return JSON.stringify(fallback);
  }
};
const identifier = (value: unknown) => {
  const id = clean(value, 100);
  return /^[a-zA-Z0-9_-]{6,100}$/.test(id) ? id : crypto.randomUUID();
};
async function sameSecret(left: string, right: string) {
  const encoder = new TextEncoder();
  const [a, b] = await Promise.all(
    [left, right].map((value) => crypto.subtle.digest("SHA-256", encoder.encode(value))),
  );
  const av = new Uint8Array(a),
    bv = new Uint8Array(b);
  let difference = 0;
  for (let index = 0; index < av.length; index += 1) difference |= av[index] ^ bv[index];
  return difference === 0 && Boolean(left) && Boolean(right);
}
async function database(request: Request) {
  // The module is injected by the Cloudflare runtime and is intentionally not
  // available to the framework-only TypeScript pass used by this repository.
  // @ts-expect-error Cloudflare runtime virtual module
  const { env } = await import("cloudflare:workers");
  const runtimeEnv = env as unknown as {
    MCP_ACCESS_TOKEN?: string;
    DB: ResearchDatabase;
  };
  const expected = String(runtimeEnv.MCP_ACCESS_TOKEN ?? process.env.MCP_ACCESS_TOKEN ?? "").trim();
  const supplied =
    request.headers
      .get("authorization")
      ?.replace(/^Bearer\s+/i, "")
      .trim() ?? "";
  return (await sameSecret(supplied, expected)) ? runtimeEnv.DB : null;
}
async function member(db: ResearchDatabase, email: string) {
  return db
    .prepare("SELECT id,email FROM members WHERE lower(email)=lower(?) AND status='active' LIMIT 1")
    .bind(email)
    .first();
}

export async function GET(request: Request) {
  const db = await database(request);
  if (!db) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const url = new URL(request.url),
    email = clean(url.searchParams.get("memberEmail"), 200).toLowerCase(),
    caseId = clean(url.searchParams.get("caseId"), 100);
  if (!email || !(await member(db, email)))
    return Response.json({ error: "會員尚未開通" }, { status: 403 });
  if (!caseId) {
    const rows = await db
      .prepare(
        "SELECT id,title,original_question AS originalQuestion,status,created_at AS createdAt,updated_at AS updatedAt FROM legal_research_cases WHERE member_email=? ORDER BY updated_at DESC LIMIT 50",
      )
      .bind(email)
      .all();
    return Response.json(
      { cases: rows.results ?? [] },
      { headers: { "cache-control": "no-store" } },
    );
  }
  const record = await db
    .prepare(
      "SELECT id,title,original_question AS originalQuestion,facts_json AS factsJson,final_conclusion AS finalConclusion,status,created_at AS createdAt,updated_at AS updatedAt FROM legal_research_cases WHERE id=? AND member_email=? LIMIT 1",
    )
    .bind(caseId, email)
    .first();
  if (!record) return Response.json({ error: "找不到研究案件" }, { status: 404 });
  const [messages, sources, alerts, searches, charges] = await Promise.all([
    db
      .prepare(
        "SELECT id,role,content_json AS contentJson,created_at AS createdAt FROM legal_research_messages WHERE case_id=? ORDER BY created_at",
      )
      .bind(caseId)
      .all(),
    db
      .prepare(
        "SELECT id,source_type AS sourceType,external_id AS externalId,title,metadata_json AS metadataJson,quote,ai_summary AS aiSummary,source_url AS sourceUrl,full_text AS fullText,full_text_read AS fullTextRead,created_at AS createdAt FROM legal_research_sources WHERE case_id=? ORDER BY created_at",
      )
      .bind(caseId)
      .all(),
    db
      .prepare(
        "SELECT id,code,severity,title,message,status,created_at AS createdAt,updated_at AS updatedAt FROM legal_research_alerts WHERE case_id=? ORDER BY created_at",
      )
      .bind(caseId)
      .all(),
    db
      .prepare(
        "SELECT id,source,query,status,result_count AS resultCount,created_at AS createdAt FROM legal_research_searches WHERE case_id=? ORDER BY created_at",
      )
      .bind(caseId)
      .all(),
    db
      .prepare(
        "SELECT id,scope_hash AS scopeHash,units,description,created_at AS createdAt FROM legal_research_charges WHERE case_id=? ORDER BY created_at",
      )
      .bind(caseId)
      .all(),
  ]);
  return Response.json(
    {
      case: record,
      messages: messages.results,
      sources: sources.results,
      alerts: alerts.results,
      searches: searches.results,
      charges: charges.results,
    },
    { headers: { "cache-control": "no-store" } },
  );
}

export async function POST(request: Request) {
  const db = await database(request);
  if (!db) return Response.json({ error: "Unauthorized" }, { status: 401 });
  let body: SavePayload;
  try {
    body = (await request.json()) as SavePayload;
  } catch {
    return Response.json({ error: "資料格式錯誤" }, { status: 400 });
  }
  const email = clean(body.memberEmail, 200).toLowerCase();
  if (!email || !(await member(db, email)))
    return Response.json({ error: "會員尚未開通" }, { status: 403 });
  if (body.action === "alert") {
    const alertId = clean(body.alertId, 100),
      status = clean(body.alertStatus, 30);
    if (!alertId || !["adopted", "later", "ignored", "muted"].includes(status))
      return Response.json({ error: "提醒狀態不正確" }, { status: 400 });
    const result = await db
      .prepare(
        "UPDATE legal_research_alerts SET status=?,updated_at=? WHERE id=? AND case_id IN (SELECT id FROM legal_research_cases WHERE member_email=?)",
      )
      .bind(status, Date.now(), alertId, email)
      .run();
    return Response.json({ saved: Boolean(result.meta.changes) });
  }
  const item = body.caseRecord,
    caseId = identifier(item?.id);
  if (!item?.originalQuestion) return Response.json({ error: "缺少研究問題" }, { status: 400 });
  const existing = await db
    .prepare("SELECT member_email AS memberEmail FROM legal_research_cases WHERE id=? LIMIT 1")
    .bind(caseId)
    .first<{ memberEmail?: string }>();
  if (existing && String(existing.memberEmail).toLowerCase() !== email) {
    return Response.json({ error: "無權修改此研究案件" }, { status: 403 });
  }
  const now = Date.now(),
    statements: ResearchStatement[] = [
      db
        .prepare(
          "INSERT INTO legal_research_cases (id,member_email,title,original_question,facts_json,final_conclusion,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,facts_json=excluded.facts_json,final_conclusion=excluded.final_conclusion,status=excluded.status,updated_at=excluded.updated_at WHERE member_email=excluded.member_email",
        )
        .bind(
          caseId,
          email,
          clean(item.title, 160) || clean(item.originalQuestion, 60),
          clean(item.originalQuestion, 2000),
          json(item.facts, []),
          clean(item.finalConclusion, 20000),
          clean(item.status, 30) || "active",
          now,
          now,
        ),
    ];
  for (const x of (body.messages ?? []).slice(0, 30))
    statements.push(
      db
        .prepare(
          "INSERT OR IGNORE INTO legal_research_messages (id,case_id,role,content_json,created_at) VALUES (?,?,?,?,?)",
        )
        .bind(
          identifier(x.id),
          caseId,
          clean(x.role, 20),
          json(x.content, {}),
          Number(x.createdAt) || now,
        ),
    );
  for (const x of (body.sources ?? []).slice(0, 40))
    statements.push(
      db
        .prepare(
          "INSERT INTO legal_research_sources (id,case_id,source_type,external_id,title,metadata_json,quote,ai_summary,source_url,full_text,full_text_read,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(case_id,source_type,external_id) DO UPDATE SET title=excluded.title,metadata_json=excluded.metadata_json,quote=excluded.quote,ai_summary=excluded.ai_summary,source_url=excluded.source_url,full_text=excluded.full_text,full_text_read=excluded.full_text_read",
        )
        .bind(
          identifier(x.id),
          caseId,
          clean(x.sourceType, 30),
          clean(x.externalId, 200),
          clean(x.title, 300),
          json(x.metadata, {}),
          clean(x.quote, 30000),
          clean(x.aiSummary, 5000),
          clean(x.sourceUrl, 1000),
          clean(x.fullText, 250_000),
          x.fullTextRead ? 1 : 0,
          now,
        ),
    );
  for (const x of (body.alerts ?? []).slice(0, 20))
    statements.push(
      db
        .prepare(
          "INSERT INTO legal_research_alerts (id,case_id,code,severity,title,message,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(case_id,code) DO UPDATE SET severity=excluded.severity,title=excluded.title,message=excluded.message,updated_at=excluded.updated_at",
        )
        .bind(
          identifier(x.id),
          caseId,
          clean(x.code, 80),
          clean(x.severity, 20),
          clean(x.title, 160),
          clean(x.message, 2000),
          clean(x.status, 30) || "pending",
          now,
          now,
        ),
    );
  for (const x of (body.searches ?? []).slice(0, 60))
    statements.push(
      db
        .prepare(
          "INSERT OR IGNORE INTO legal_research_searches (id,case_id,source,query,status,result_count,created_at) VALUES (?,?,?,?,?,?,?)",
        )
        .bind(
          identifier(x.id),
          caseId,
          clean(x.source, 40),
          clean(x.query, 300),
          clean(x.status, 30),
          Math.max(0, Number(x.resultCount) || 0),
          now,
        ),
    );
  const chargeScope = clean(body.charge?.scopeHash, 100);
  const chargeReused = Boolean(
    chargeScope &&
      (await db
        .prepare("SELECT id FROM legal_research_charges WHERE case_id=? AND scope_hash=? LIMIT 1")
        .bind(caseId, chargeScope)
        .first()),
  );
  if (chargeScope && !chargeReused)
    statements.push(
      db
        .prepare(
          "INSERT OR IGNORE INTO legal_research_charges (id,case_id,scope_hash,units,description,created_at) VALUES (?,?,?,?,?,?)",
        )
        .bind(
          identifier(body.charge?.id),
          caseId,
          chargeScope,
          Math.max(0, Math.min(20, Number(body.charge?.units) || 0)),
          clean(body.charge?.description, 500),
          now,
        ),
    );
  await db.batch(statements);
  return Response.json(
    { saved: true, caseId, chargeReused },
    { headers: { "cache-control": "no-store" } },
  );
}
