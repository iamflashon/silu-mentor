import { authenticatedEmail, requireMember } from "../../../lib/member-auth";
import { cleanText, htmlEscape, mcpDatabase, normalizeScope, randomToken, sha256, validRedirectUri } from "../../../lib/student-mcp-auth";

type AuthParams = { clientId: string; redirectUri: string; state: string; scope: string; codeChallenge: string };

const BETA_AUTO_LIMIT = 10;
const BETA_DAILY_CALL_LIMIT = 50;
const BETA_AUTO_ID_PREFIX = "beta_auto_";
const BETA_WAIT_ID_PREFIX = "beta_wait_";

const securityHeaders = (cookie?: string) => ({
  "content-type": "text/html; charset=utf-8",
  "cache-control": "no-store",
  "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  ...(cookie ? { "set-cookie": cookie } : {}),
});

function page(title: string, body: string, status = 200, cookie?: string) {
  return new Response(`<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${htmlEscape(title)}</title><style>body{margin:0;background:#eef5f7;color:#183d4d;font:16px/1.65 system-ui,sans-serif}.card{width:min(520px,calc(100% - 32px));margin:9vh auto;padding:30px;box-sizing:border-box;border:1px solid #cfe0e4;border-radius:22px;background:#fff;box-shadow:0 22px 60px #1644581a}.mark{display:grid;place-items:center;width:44px;height:44px;border-radius:13px;background:#174e63;color:#fff;font-weight:900}h1{margin:18px 0 8px;font-size:26px}p{color:#607984}.scope{margin:20px 0;padding:15px;border-radius:14px;background:#eef8f7}.scope b{display:block;margin-bottom:5px;color:#176b70}form{display:flex;gap:10px;margin-top:22px}button{flex:1;padding:12px 16px;border:0;border-radius:11px;font:inherit;font-weight:800;cursor:pointer}.allow{background:#176d72;color:#fff}.deny{background:#e8eef0;color:#45616b}</style></head><body><main class="card"><span class="mark">智</span>${body}</main></body></html>`, { status, headers: securityHeaders(cookie) });
}

async function clientFor(clientId: string, redirectUri: string) {
  const client = await mcpDatabase().prepare("SELECT client_id AS clientId,client_name AS clientName,redirect_uris_json AS redirectUrisJson FROM mcp_oauth_clients WHERE client_id=? AND status='active' LIMIT 1").bind(clientId).first<Record<string, unknown>>();
  if (!client) return null;
  let uris: string[] = [];
  try { uris = JSON.parse(String(client.redirectUrisJson)); } catch { /* invalid client row */ }
  return uris.includes(redirectUri) ? client : null;
}

function paramsFrom(values: { get(name: string): FormDataEntryValue | string | null }): AuthParams {
  return {
    clientId: cleanText(values.get("client_id"), 160),
    redirectUri: validRedirectUri(values.get("redirect_uri")),
    state: cleanText(values.get("state"), 500),
    scope: normalizeScope(values.get("scope")),
    codeChallenge: cleanText(values.get("code_challenge"), 180),
  };
}

function clientRedirect(redirectUri: string, values: Record<string, string>) {
  const url = new URL(redirectUri);
  for (const [key, value] of Object.entries(values)) if (value) url.searchParams.set(key, value);
  return Response.redirect(url, 302);
}

async function ensureBetaMcpAccess(request: Request) {
  const email = authenticatedEmail(request);
  if (!email) return { status: "anonymous" as const };
  const db = mcpDatabase();
  const displayName = email.split("@")[0] || email;
  let member = await db.prepare("SELECT id,status FROM members WHERE lower(email)=? LIMIT 1").bind(email).first<{ id: number; status: string }>();
  if (!member) {
    await db.prepare(`INSERT INTO members (email,password_hash,display_name,role,can_admin,status,class_name,created_at,updated_at)
      VALUES (?,?,?,'student',0,'active','MCP 首批測試',unixepoch(),unixepoch())
      ON CONFLICT(email) DO NOTHING`).bind(email, `chatgpt$${crypto.randomUUID()}${crypto.randomUUID()}`, displayName).run();
    member = await db.prepare("SELECT id,status FROM members WHERE lower(email)=? LIMIT 1").bind(email).first<{ id: number; status: string }>();
  }
  if (!member || member.status !== "active") return { status: "paused" as const };

  await db.prepare("UPDATE mcp_access_accounts SET member_id=COALESCE(member_id,?),updated_at=unixepoch() WHERE lower(email)=?").bind(member.id, email).run();
  let account = await db.prepare("SELECT status FROM mcp_access_accounts WHERE lower(email)=? LIMIT 1").bind(email).first<{ status: string }>();
  if (!account) {
    const autoId = `${BETA_AUTO_ID_PREFIX}${crypto.randomUUID().replaceAll("-", "")}`;
    await db.prepare(`INSERT INTO mcp_access_accounts (id,member_id,email,display_name,account_type,enterprise_id,status,daily_call_limit,scopes_json,notes,created_at,updated_at)
      SELECT ?,?,?,?,'individual',NULL,'active',?,'["resources.read"]','首批 10 名自動測試會員',unixepoch(),unixepoch()
      WHERE (SELECT COUNT(*) FROM mcp_access_accounts WHERE id LIKE '${BETA_AUTO_ID_PREFIX}%') < ?
      ON CONFLICT(email) DO NOTHING`).bind(autoId, member.id, email, displayName, BETA_DAILY_CALL_LIMIT, BETA_AUTO_LIMIT).run();
    account = await db.prepare("SELECT status FROM mcp_access_accounts WHERE lower(email)=? LIMIT 1").bind(email).first<{ status: string }>();
  }
  if (!account) {
    const waitId = `${BETA_WAIT_ID_PREFIX}${crypto.randomUUID().replaceAll("-", "")}`;
    await db.prepare(`INSERT INTO mcp_access_accounts (id,member_id,email,display_name,account_type,enterprise_id,status,daily_call_limit,scopes_json,notes,created_at,updated_at)
      VALUES (?,?,?,?,'individual',NULL,'pending',0,'["resources.read"]','首批測試名額已滿；等待管理員審核',unixepoch(),unixepoch())
      ON CONFLICT(email) DO NOTHING`).bind(waitId, member.id, email, displayName).run();
    account = await db.prepare("SELECT status FROM mcp_access_accounts WHERE lower(email)=? LIMIT 1").bind(email).first<{ status: string }>();
  }
  return { status: account?.status === "active" ? "active" as const : account?.status === "pending" ? "pending" as const : "paused" as const };
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const params = paramsFrom(url.searchParams);
  if (url.searchParams.get("response_type") !== "code" || url.searchParams.get("code_challenge_method") !== "S256" || !params.clientId || !params.redirectUri || !params.scope || !params.codeChallenge || params.codeChallenge.length < 43) {
    return page("連線資料不完整", "<h1>無法連接</h1><p>ChatGPT 傳來的 OAuth／PKCE 連線資料不完整，請回到 ChatGPT 重新加入這個工具。</p>", 400);
  }
  const client = await clientFor(params.clientId, params.redirectUri);
  if (!client) return page("未核准的應用程式", "<h1>無法連接</h1><p>這個回傳網址未登錄，連線已停止。</p>", 400);
  if (!authenticatedEmail(request)) {
    const returnTo = `${url.pathname}${url.search}`;
    return Response.redirect(new URL(`/signin-with-chatgpt?return_to=${encodeURIComponent(returnTo)}`, url.origin), 302);
  }
  const betaAccess = await ensureBetaMcpAccess(request);
  if (betaAccess.status === "pending") {
    return page("首批測試名額已滿", "<h1>首批 10 名測試名額已滿</h1><p>你的帳號目前不在開放名單內，我們已替你登記測試申請。請等待管理員審核開通後，再回到 ChatGPT 重新連接。</p>", 403);
  }
  if (betaAccess.status === "paused") {
    return page("帳號尚未開通", "<h1>帳號尚未開通</h1><p>這個帳號目前未啟用，請聯絡管理員。</p>", 403);
  }
  const auth = await requireMember(request);
  if ("error" in auth) return page("會員尚未開通", "<h1>會員尚未開通</h1><p>這個 ChatGPT 帳號還沒有平台權限，請聯絡管理員。</p>", 403);
  const csrf = randomToken("csrf");
  const secure = url.protocol === "https:" ? "; Secure" : "";
  const cookieName = secure ? "__Host-IBRAIN_MCP_CSRF" : "IBRAIN_MCP_CSRF";
  const cookie = `${cookieName}=${csrf}; HttpOnly${secure}; Path=/; SameSite=Lax; Max-Age=600`;
  const hidden = Object.entries({ client_id: params.clientId, redirect_uri: params.redirectUri, state: params.state, scope: params.scope, code_challenge: params.codeChallenge, csrf_token: csrf }).map(([key, value]) => `<input type="hidden" name="${key}" value="${htmlEscape(value)}">`).join("");
  const writePermission = params.scope.includes("progress.write") ? "，並在你同意工具操作時保存陪考紀錄" : "";
  return page("授權 iBrain 考試顧問", `<h1>允許 ChatGPT 使用考試工具？</h1><p>${htmlEscape(auth.member.displayName || auth.member.email)}，ChatGPT 想連接 iBrain 考試顧問。</p><div class="scope"><b>這次允許</b>搜尋已發布的高點資源、讀取你的備考進度${writePermission}。</div><p>不會取得你的 ChatGPT 密碼，也不會代替你購買課程。</p><form method="post" action="/mcp/authorize">${hidden}<button class="deny" name="decision" value="deny">取消</button><button class="allow" name="decision" value="allow">允許連接</button></form>`, 200, cookie);
}

export async function POST(request: Request) {
  const form = await request.formData().catch(() => null);
  if (!form) return page("授權失敗", "<h1>授權資料無效</h1><p>請回到 ChatGPT 重新操作。</p>", 400);
  const params = paramsFrom(form);
  const cookie = request.headers.get("cookie") || "";
  const csrfCookie = cookie.match(/(?:^|;\s*)(?:__Host-)?IBRAIN_MCP_CSRF=([^;]+)/)?.[1] || "";
  const csrfForm = cleanText(form.get("csrf_token"), 220);
  const auth = await requireMember(request);
  if ("error" in auth || !params.scope || !csrfCookie || csrfCookie !== csrfForm || !await clientFor(params.clientId, params.redirectUri)) {
    return page("授權失敗", "<h1>授權已過期</h1><p>為了保護帳號，請回到 ChatGPT 重新連接。</p>", 400);
  }
  if (form.get("decision") !== "allow") return clientRedirect(params.redirectUri, { error: "access_denied", state: params.state });
  const code = randomToken("ibrain_code");
  await mcpDatabase().prepare(`INSERT INTO mcp_oauth_authorization_codes (code_hash,client_id,member_id,redirect_uri,scope,code_challenge,expires_at,created_at) VALUES (?,?,?,?,?,?,unixepoch()+600,unixepoch())`).bind(
    await sha256(code), params.clientId, auth.member.id, params.redirectUri, params.scope, params.codeChallenge,
  ).run();
  return clientRedirect(params.redirectUri, { code, state: params.state });
}
