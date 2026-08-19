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

interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  BUCKET: R2Bucket;
  JUDICIAL_API_USER?: string;
  JUDICIAL_API_PASSWORD?: string;
  ENTRY_ADMIN_EMAIL?: string;
  ENTRY_ADMIN_PASSWORD?: string;
  ENTRY_SESSION_SECRET?: string;
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
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
  if (await isAdminSessionCookie(request, env.ENTRY_SESSION_SECRET)) headers.set("x-silu-admin-entry", "1");
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
    return handler.fetch(await addAdminEntryContext(request, env), env, ctx);
  },

  async scheduled(
    controller: { cron: string; scheduledTime: number },
    env: Env,
    ctx: ExecutionContext,
  ): Promise<void> {
    const judicialCrons = new Set(["*/1 16-21 * * *"]);
    if (!judicialCrons.has(controller.cron)) return;
    ctx.waitUntil(
      (async () => {
        const response = await handler.fetch(
          new Request("https://silu-mentor.internal/api/judicial-sync", {
            method: "POST",
            headers: { "content-type": "application/json", "x-scheduled-sync": "1" },
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
