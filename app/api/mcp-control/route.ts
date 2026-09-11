import { env } from "cloudflare:workers";
import { requireAdmin } from "../../../lib/member-auth";

type Input = Record<string, unknown>;

function text(value: unknown, max = 500) {
  return String(value ?? "").trim().slice(0, max);
}

function limit(value: unknown, fallback: number, max: number) {
  const parsed = Math.round(Number(value));
  return Number.isFinite(parsed) ? Math.max(0, Math.min(max, parsed)) : fallback;
}

function status(value: unknown, allowed: string[], fallback: string) {
  const selected = text(value, 30);
  return allowed.includes(selected) ? selected : fallback;
}

function email(value: unknown) {
  const normalized = text(value, 180).toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) ? normalized : "";
}

export async function GET(request: Request) {
  const auth = await requireAdmin(request);
  if ("error" in auth) return auth.error;
  const db = (env as unknown as { DB: D1Database }).DB;
  try {
    const [knowledge, accounts, siteAccounts, enterprises, usage] = await Promise.all([
      db.prepare(`SELECT id,title,category,content,source_url AS sourceUrl,status,review_note AS reviewNote,reviewed_by AS reviewedBy,reviewed_at AS reviewedAt,updated_at AS updatedAt FROM mcp_knowledge_items ORDER BY updated_at DESC LIMIT 200`).all(),
      db.prepare(`SELECT a.id,a.email,a.display_name AS displayName,a.account_type AS accountType,a.enterprise_id AS enterpriseId,a.status,a.daily_call_limit AS dailyCallLimit,a.scopes_json AS scopesJson,a.notes,a.updated_at AS updatedAt,e.name AS enterpriseName,(SELECT COALESCE(SUM(p.call_count),0) FROM platform_usage_events p WHERE lower(p.user_key)=lower(a.email) AND p.category='mcp' AND p.created_at>=unixepoch('now','start of day')) AS todayCalls FROM mcp_access_accounts a LEFT JOIN mcp_enterprises e ON e.id=a.enterprise_id ORDER BY a.updated_at DESC LIMIT 300`).all(),
      db.prepare(`SELECT a.id,a.member_id AS memberId,m.email,m.display_name AS displayName,a.status,a.created_at AS createdAt,a.updated_at AS updatedAt,m.last_seen_at AS lastSeenAt,(SELECT COALESCE(SUM(p.call_count),0) FROM platform_usage_events p WHERE lower(p.user_key)=lower(m.email) AND p.category='model' AND p.created_at>=unixepoch('now','start of day')) AS todayCalls FROM member_exam_access a INNER JOIN members m ON m.id=a.member_id WHERE a.exam_category='angle-pedia' ORDER BY COALESCE(m.last_seen_at,a.created_at) DESC LIMIT 300`).all(),
      db.prepare(`SELECT e.id,e.name,e.code,e.status,e.monthly_call_limit AS monthlyCallLimit,e.notes,e.updated_at AS updatedAt,COUNT(DISTINCT a.id) AS accountCount,COALESCE(SUM(CASE WHEN p.created_at>=unixepoch('now','start of month') THEN p.call_count ELSE 0 END),0) AS monthCalls FROM mcp_enterprises e LEFT JOIN mcp_access_accounts a ON a.enterprise_id=e.id LEFT JOIN platform_usage_events p ON lower(p.user_key)=lower(a.email) AND p.category='mcp' GROUP BY e.id ORDER BY e.updated_at DESC`).all(),
      db.prepare(`SELECT COUNT(*) AS calls,COUNT(DISTINCT user_key) AS activeUsers,COALESCE(SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END),0) AS failures FROM platform_usage_events WHERE category='mcp' AND created_at>=unixepoch()-2592000`).first(),
    ]);
    return Response.json({ knowledge: knowledge.results, accounts: accounts.results, siteAccounts: siteAccounts.results, enterprises: enterprises.results, usage });
  } catch (error) {
    return Response.json({ error: "MCP 獨立管控資料庫尚未完成更新", detail: error instanceof Error ? error.message : "database unavailable" }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const auth = await requireAdmin(request);
  if ("error" in auth) return auth.error;
  const db = (env as unknown as { DB: D1Database }).DB;
  const body = await request.json() as Input;
  const action = text(body.action, 40);

  if (action === "save_knowledge") {
    const title = text(body.title, 160);
    const content = text(body.content, 30000);
    if (!title || !content) return Response.json({ error: "標題與內容不可空白" }, { status: 400 });
    const itemStatus = status(body.status, ["draft", "review", "published", "rejected"], "draft");
    const reviewer = text(auth.member?.email ?? "admin", 180);
    const id = text(body.id, 80) || crypto.randomUUID();
    await db.prepare(`INSERT INTO mcp_knowledge_items (id,title,category,content,source_url,status,review_note,reviewed_by,reviewed_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,CASE WHEN ? IN ('published','rejected') THEN unixepoch() ELSE NULL END,unixepoch(),unixepoch()) ON CONFLICT(id) DO UPDATE SET title=excluded.title,category=excluded.category,content=excluded.content,source_url=excluded.source_url,status=excluded.status,review_note=excluded.review_note,reviewed_by=excluded.reviewed_by,reviewed_at=excluded.reviewed_at,updated_at=unixepoch()`).bind(
      id, title, text(body.category, 80) || "一般", content, text(body.sourceUrl, 1000), itemStatus, text(body.reviewNote, 2000), reviewer, itemStatus,
    ).run();
    return Response.json({ saved: true, id });
  }

  if (action === "save_enterprise") {
    const name = text(body.name, 120);
    const code = text(body.code, 60).toLowerCase().replace(/[^a-z0-9-]/g, "");
    if (!name || !code) return Response.json({ error: "請輸入企業名稱與代碼" }, { status: 400 });
    const id = text(body.id, 80) || crypto.randomUUID();
    await db.prepare(`INSERT INTO mcp_enterprises (id,name,code,status,monthly_call_limit,notes,created_at,updated_at) VALUES (?,?,?,?,?,?,unixepoch(),unixepoch()) ON CONFLICT(id) DO UPDATE SET name=excluded.name,code=excluded.code,status=excluded.status,monthly_call_limit=excluded.monthly_call_limit,notes=excluded.notes,updated_at=unixepoch()`).bind(
      id, name, code, status(body.status, ["active", "paused"], "active"), limit(body.monthlyCallLimit, 10000, 10000000), text(body.notes, 2000),
    ).run();
    return Response.json({ saved: true, id });
  }

  if (action === "save_account") {
    const accountEmail = email(body.email);
    if (!accountEmail) return Response.json({ error: "請輸入正確的 Email" }, { status: 400 });
    const displayName = text(body.displayName, 100);
    const accountType = body.accountType === "enterprise" ? "enterprise" : "individual";
    const enterpriseId = accountType === "enterprise" ? text(body.enterpriseId, 80) || null : null;
    if (accountType === "enterprise" && !enterpriseId) return Response.json({ error: "企業會員必須選擇企業" }, { status: 400 });
    let member = await db.prepare(`SELECT id FROM members WHERE lower(email)=? LIMIT 1`).bind(accountEmail).first<{ id: number }>();
    if (!member) {
      const created = await db.prepare(`INSERT INTO members (email,password_hash,display_name,role,can_admin,status,class_name,created_at,updated_at) VALUES (?,'',?,'student',0,'active','MCP 獨立會員',unixepoch(),unixepoch()) RETURNING id`).bind(accountEmail, displayName).first<{ id: number }>();
      member = created ?? null;
    }
    const id = text(body.id, 80) || crypto.randomUUID();
    await db.prepare(`INSERT INTO mcp_access_accounts (id,member_id,email,display_name,account_type,enterprise_id,status,daily_call_limit,scopes_json,notes,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,unixepoch(),unixepoch()) ON CONFLICT(id) DO UPDATE SET member_id=excluded.member_id,email=excluded.email,display_name=excluded.display_name,account_type=excluded.account_type,enterprise_id=excluded.enterprise_id,status=excluded.status,daily_call_limit=excluded.daily_call_limit,scopes_json=excluded.scopes_json,notes=excluded.notes,updated_at=unixepoch()`).bind(
      id, member?.id ?? null, accountEmail, displayName, accountType, enterpriseId, status(body.status, ["active", "pending", "paused"], "active"), limit(body.dailyCallLimit, 100, 100000), JSON.stringify(Array.isArray(body.scopes) ? body.scopes.filter((scope) => ["resources.read", "progress.read", "progress.write"].includes(String(scope))) : ["resources.read", "progress.read"]), text(body.notes, 2000),
    ).run();
    return Response.json({ saved: true, id });
  }

  if (action === "save_site_account") {
    const id = Number(body.id);
    if (!Number.isInteger(id) || id < 1) return Response.json({ error: "找不到網站測試會員" }, { status: 400 });
    const accountStatus = status(body.status, ["active", "pending", "paused"], "pending");
    const result = await db.prepare(`UPDATE member_exam_access SET status=?,updated_at=unixepoch() WHERE id=? AND exam_category='angle-pedia'`)
      .bind(accountStatus, id)
      .run();
    return result.meta.changes ? Response.json({ saved: true, id }) : Response.json({ error: "找不到網站測試會員" }, { status: 404 });
  }

  return Response.json({ error: "不支援的操作" }, { status: 400 });
}
