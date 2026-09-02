import { NextResponse, type NextRequest } from "next/server";
import { isAdminEntryAuthenticated, isPlatformMemberAuthenticated } from "./lib/admin-entry-auth";

const PUBLIC_QA_PATHS = [
  "/accounting/qa",
  "/member-login",
  "/member-register",
  "/api/accounting/tutor",
  "/api/accounting/qa-access",
  "/api/accounting/history",
  "/api/notes",
  // Machine-to-machine textbook sync is protected by its own short-lived,
  // signed bearer token inside the route. Cloudflare Access service tokens do
  // not carry a user email, so the admin-entry gate must let this request reach
  // the route-level verifier.
  "/api/sync/textbooks",
  // Machine-to-machine RTX node routes verify both Cloudflare Access Service
  // Auth and LOCAL_NODE_TOKEN inside the route itself.
  "/api/local-node",
];

const NO_CACHE_PATHS = [
  "/teachers/pengli/ai-access",
  "/teachers/pengli/coach",
];

function continueRequest(requestHeaders: Headers, pathname: string) {
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  if (NO_CACHE_PATHS.includes(pathname)) {
    response.headers.set("cache-control", "no-store, no-cache, must-revalidate, max-age=0");
    response.headers.set("cdn-cache-control", "no-store");
    response.headers.set("cloudflare-cdn-cache-control", "no-store");
    response.headers.set("x-silu-rules-version", "2026-08-28-v2");
  }
  return response;
}

function isQaAllowedPath(pathname: string) {
  return PUBLIC_QA_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`))
    || pathname.startsWith("/cdn-cgi/access/")
    || /\.[a-z0-9]{2,8}$/i.test(pathname);
}

/**
 * Cloudflare Access authenticates the Google account before the request reaches
 * the application.  Reuse the verified email as the platform's existing member
 * key so Sites and Workers never create parallel member records.
 *
 * The JWT-presence check prevents an unprotected request from being promoted
 * merely by supplying the public email header.  Cloudflare Access remains the
 * outer enforcement layer and is responsible for validating that JWT.
 */
export async function middleware(request: NextRequest) {
  const requestHeaders = new Headers(request.headers);
  requestHeaders.delete("x-silu-auth-route");
  const cloudflareAccessHost =
    request.nextUrl.hostname === "silu-mentor.iamflashon.workers.dev";
  const existingIdentity = requestHeaders.get("oai-authenticated-user-email");
  const accessEmail = requestHeaders.get("cf-access-authenticated-user-email");
  const accessJwt = requestHeaders.get("cf-access-jwt-assertion");

  if (cloudflareAccessHost && !existingIdentity && accessEmail && accessJwt) {
    requestHeaders.set("oai-authenticated-user-email", accessEmail.trim().toLowerCase());
    requestHeaders.set("x-silu-identity-provider", "cloudflare-google");
  }

  if (isQaAllowedPath(request.nextUrl.pathname)) {
    if (request.nextUrl.pathname === "/member-login" || request.nextUrl.pathname === "/member-register") {
      requestHeaders.set("x-silu-auth-route", "1");
    }
    return continueRequest(requestHeaders, request.nextUrl.pathname);
  }

  const authenticatedRequest = new Request(request.url, {
    method: request.method,
    headers: requestHeaders,
  });
  if (await isAdminEntryAuthenticated(authenticatedRequest)) {
    requestHeaders.set("x-silu-admin-entry", "1");
    return continueRequest(requestHeaders, request.nextUrl.pathname);
  }

  // Active members may reach their own platform pages. Individual page and API
  // guards still enforce class, admin, and document-level permissions.
  if (await isPlatformMemberAuthenticated(authenticatedRequest)) {
    return continueRequest(requestHeaders, request.nextUrl.pathname);
  }

  if (request.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "此內部測試功能只限管理員" }, { status: 403 });
  }

  const returnTo = `${request.nextUrl.pathname}${request.nextUrl.search}`;
  const loginUrl = new URL("/member-login", request.url);
  loginUrl.searchParams.set("return_to", returnTo);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
