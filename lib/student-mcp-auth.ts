import { env } from "cloudflare:workers";

export const MCP_SCOPES = ["resources.read", "progress.read", "progress.write"] as const;
export const MCP_DEFAULT_SCOPE = "resources.read progress.read";

export type McpIdentity = {
  tokenId: string;
  memberId: number;
  email: string;
  name: string;
  role: string;
  scope: string;
};

export function mcpDatabase() {
  return (env as unknown as { DB: D1Database }).DB;
}

export function mcpDailyCallLimit() {
  const configured = Number((env as unknown as { MCP_DAILY_CALL_LIMIT?: string }).MCP_DAILY_CALL_LIMIT || 100);
  return Number.isFinite(configured) ? Math.max(10, Math.min(1000, Math.trunc(configured))) : 100;
}

export function originOf(request: Request) {
  const url = new URL(request.url);
  return `${url.protocol}//${url.host}`;
}

export function cleanText(value: unknown, max = 200) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export function normalizeScope(value: unknown) {
  const raw = cleanText(value, 200);
  if (!raw) return MCP_DEFAULT_SCOPE;
  const requested = [...new Set(raw.split(/\s+/).filter(Boolean))];
  if (requested.some((scope) => !MCP_SCOPES.includes(scope as typeof MCP_SCOPES[number]))) return "";
  return MCP_SCOPES.filter((scope) => requested.includes(scope)).join(" ");
}

export function hasScope(identity: McpIdentity, scope: typeof MCP_SCOPES[number]) {
  return identity.scope.split(/\s+/).includes(scope);
}

export async function sha256(value: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function pkceChallenge(verifier: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  let binary = "";
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
}

export function randomToken(prefix: string) {
  return `${prefix}_${crypto.randomUUID().replaceAll("-", "")}${crypto.randomUUID().replaceAll("-", "")}`;
}

export function validRedirectUri(value: unknown) {
  const raw = cleanText(value, 1000);
  try {
    const url = new URL(raw);
    return url.protocol === "https:" || (url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname)) ? url.toString() : "";
  } catch {
    return "";
  }
}

export function corsHeaders(request?: Request) {
  return {
    "access-control-allow-origin": request?.headers.get("origin") || "*",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "authorization, content-type, mcp-protocol-version, mcp-session-id",
    "access-control-expose-headers": "mcp-session-id, www-authenticate",
    "cache-control": "no-store",
    vary: "origin",
  };
}

export async function authenticateMcp(request: Request): Promise<McpIdentity | null> {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim() || "";
  if (!token) return null;
  const tokenHash = await sha256(token);
  const db = mcpDatabase();
  const row = await db.prepare(`
    SELECT t.id AS tokenId,t.member_id AS memberId,t.scope,m.email,m.display_name AS name,m.role
    FROM mcp_oauth_tokens t
    INNER JOIN members m ON m.id=t.member_id
    WHERE t.access_token_hash=? AND t.revoked_at IS NULL AND t.access_expires_at>unixepoch() AND m.status='active'
    LIMIT 1
  `).bind(tokenHash).first<Record<string, unknown>>();
  if (!row) return null;
  await db.prepare("UPDATE mcp_oauth_tokens SET last_used_at=unixepoch() WHERE id=?").bind(String(row.tokenId)).run();
  return {
    tokenId: String(row.tokenId), memberId: Number(row.memberId), email: String(row.email),
    name: String(row.name || ""), role: String(row.role || "student"), scope: String(row.scope || ""),
  };
}

export function unauthorizedMcp(request: Request) {
  const metadata = `${originOf(request)}/.well-known/oauth-protected-resource`;
  return Response.json({ jsonrpc: "2.0", error: { code: -32001, message: "Authorization required" }, id: null }, {
    status: 401,
    headers: { ...corsHeaders(request), "www-authenticate": `Bearer resource_metadata="${metadata}"` },
  });
}

export function htmlEscape(value: unknown) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[character] || character);
}
