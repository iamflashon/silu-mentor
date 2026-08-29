/** Cloudflare Worker entry point for the vinext-starter template. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";
import {
  clearAdminEntryCookie,
  createAdminEntryCookie,
  isAdminCredentials,
  isAdminSessionCookie,
  safeReturnTo,
} from "../lib/admin-entry-auth";
import {
  clearMemberSessionCookie,
  createMemberSessionCookie,
  getMemberSession,
  verifyMemberPassword,
} from "../lib/member-session-auth";

interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  BUCKET: R2Bucket;
  JUDICIAL_API_USER?: string;
  JUDICIAL_API_PASSWORD?: string;
  JUDICIAL_SYNC_WAKE_TOKEN?: string;
  ENTRY_ADMIN_EMAIL?: string;
  ENTRY_ADMIN_PASSWORD?: string;
  ENTRY_SESSION_SECRET?: string;
  MEMBER_SESSION_SECRET?: string;
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
}

type MemberRow = {
  id: number;
  email: string;
  display_name: string;
  role: string;
  can_admin: number;
  status: string;
  class_name: string;
  password_hash: string;
};

function publicMember(member: MemberRow) {
  return { id: member.id, email: member.email, displayName: member.display_name, role: member.role, canAdmin: Boolean(member.can_admin), status: member.status, className: member.class_name };
}

async function handleMemberRequest(request: Request, env: Env) {
  const pathname = new URL(request.url).pathname;
  if (pathname === "/api/member/login" && request.method === "POST") {
    let body: { email?: unknown; password?: unknown; returnTo?: unknown } = {};
    try { body = await request.json(); } catch { /* handled as an invalid login below */ }
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const password = typeof body.password === "string" ? body.password : "";
    if (!email || !password) return Response.json({ error: "請輸入會員帳號與密碼。" }, { status: 400, headers: { "cache-control": "no-store" } });
    const member = await env.DB.prepare("SELECT id, email, display_name, role, can_admin, status, class_name, password_hash FROM members WHERE email = ? LIMIT 1").bind(email).first<MemberRow>();
    if (!member || member.status !== "active" || !member.password_hash || !(await verifyMemberPassword(password, member.password_hash))) {
      return Response.json({ error: "會員帳號或密碼錯誤，或帳號目前已停用。" }, { status: 401, headers: { "cache-control": "no-store" } });
    }
    const cookie = await createMemberSessionCookie({ memberId: member.id, email: member.email }, env);
    if (!cookie) return Response.json({ error: "會員登入服務尚未完成設定。" }, { status: 503, headers: { "cache-control": "no-store" } });
    await env.DB.prepare("UPDATE members SET last_seen_at = ?, updated_at = ? WHERE id = ?").bind(Date.now(), Date.now(), member.id).run();
    return Response.json({ ok: true, returnTo: safeReturnTo(body.returnTo) }, { headers: { "cache-control": "no-store", "set-cookie": cookie } });
  }
  if (pathname === "/api/member/session" && request.method === "GET") {
    const session = await getMemberSession(request, env);
    if (!session) return Response.json({ authenticated: false, member: null }, { headers: { "cache-control": "no-store" } });
    const member = await env.DB.prepare("SELECT id, email, display_name, role, can_admin, status, class_name, password_hash FROM members WHERE id = ? LIMIT 1").bind(session.memberId).first<MemberRow>();
    const authenticated = Boolean(member && member.status === "active" && member.email.trim().toLowerCase() === session.email);
    return Response.json({ authenticated, member: authenticated && member ? publicMember(member) : null }, { headers: { "cache-control": "no-store" } });
  }
  if (pathname === "/api/member/logout" && request.method === "POST") {
    return Response.json({ ok: true }, { headers: { "cache-control": "no-store", "set-cookie": clearMemberSessionCookie() } });
  }
  return null;
}

async function handleAdminEntryRequest(request: Request, env: Env) {
  const pathname = new URL(request.url).pathname;
  if (pathname === "/api/admin-entry/login" && request.method === "POST") {
    let body: { email?: unknown; password?: unknown; returnTo?: unknown } = {};
    try { body = await request.json(); } catch { /* handled as an invalid login below */ }
    const email = typeof body.email === "string" ? body.email : "";
    const password = typeof body.password === "string" ? body.password : "";
    if (!email || !password || !(await isAdminCredentials(email, password, env))) {
      return Response.json({ error: "管理員帳號或密碼錯誤。" }, { status: 401, headers: { "cache-control": "no-store" } });
    }
    const cookie = await createAdminEntryCookie(env);
    if (!cookie) return Response.json({ error: "管理員登入服務尚未完成設定。" }, { status: 503, headers: { "cache-control": "no-store" } });
    return Response.json({ ok: true, returnTo: safeReturnTo(body.returnTo) }, { headers: { "cache-control": "no-store", "set-cookie": cookie } });
  }
  if (pathname === "/api/admin-entry/session" && request.method === "GET") {
    const authenticated = await isAdminSessionCookie(request, env.ENTRY_SESSION_SECRET);
    return Response.json({
      authenticated,
      member: authenticated ? { displayName: "管理員", email: "admin", role: "teacher", canAdmin: true, status: "active" } : null,
    }, { headers: { "cache-control": "no-store" } });
  }
  if (pathname === "/api/admin-entry/logout" && request.method === "POST") {
    return Response.json({ ok: true }, { headers: { "cache-control": "no-store", "set-cookie": clearAdminEntryCookie() } });
  }
  return null;
}

async function addAdminEntryContext(request: Request, env: Env) {
  const headers = new Headers(request.headers);
  headers.delete("x-silu-admin-entry");
  headers.delete("x-silu-member-id");
  // Scheduled-only headers must never be accepted from a public request. The
  // scheduled handler below dispatches directly to the app router and bypasses
  // this sanitising boundary.
  headers.delete("x-scheduled-sync");
  headers.delete("x-sync-source");
  if (await isAdminSessionCookie(request, env.ENTRY_SESSION_SECRET)) headers.set("x-silu-admin-entry", "1");
  const session = await getMemberSession(request, env);
  if (session) {
    const member = await env.DB.prepare("SELECT id, email, status FROM members WHERE id = ? LIMIT 1").bind(session.memberId).first<{ id: number; email: string; status: string }>();
    if (member && member.status === "active" && member.email.trim().toLowerCase() === session.email) headers.set("x-silu-member-id", String(member.id));
  }
  return new Request(request, { headers });
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

// Image security config. SVG sources with .svg extension auto-skip the
// optimization endpoint on the client side (served directly, no proxy).
// To route SVGs through the optimizer (with security headers), set
// dangerouslyAllowSVG: true in next.config.js and uncomment below:
// const imageConfig: ImageConfig = { dangerouslyAllowSVG: true };

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/_vinext/image") {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      return handleImageOptimization(request, {
        fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
        transformImage: async (body, { width, format, quality }) => {
          const result = await env.IMAGES.input(body).transform(width > 0 ? { width } : {}).output({ format, quality });
          return result.response();
        },
      }, allowedWidths);
    }

    const adminEntryResponse = await handleAdminEntryRequest(request, env);
    if (adminEntryResponse) return adminEntryResponse;
    const memberResponse = await handleMemberRequest(request, env);
    if (memberResponse) return memberResponse;
    return handler.fetch(await addAdminEntryContext(request, env), env, ctx);
  },

  async scheduled(
    controller: { cron: string; scheduledTime: number },
    env: Env,
    ctx: ExecutionContext,
  ): Promise<void> {
    // Accept the current one-minute schedule and the previous five-minute
    // schedules during Cloudflare's trigger propagation window. Previously the
    // Wrangler config emitted the five-minute values while this handler only
    // accepted the one-minute value, so every real Cron event was ignored.
    const judicialCrons = new Set([
      "*/1 16-21 * * *",
      "30-59/5 16 * * *",
      "*/5 17-21 * * *",
    ]);
    if (!judicialCrons.has(controller.cron)) return;
    ctx.waitUntil(
      (async () => {
        const response = await handler.fetch(
          new Request("https://silu-mentor.internal/api/judicial-sync", {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-scheduled-sync": "1",
              "x-sync-source": "worker-cron",
            },
            body: JSON.stringify({ action: "sync", limit: 120 }),
          }),
          env,
          ctx,
        );
        if (!response.ok) {
          console.error("Scheduled judicial sync failed", controller.scheduledTime, response.status, await response.text());
        }
      })(),
    );
  },
};

export default worker;
