import { NextResponse, type NextRequest } from "next/server";

/**
 * Cloudflare Access authenticates the Google account before the request reaches
 * the application.  Reuse the verified email as the platform's existing member
 * key so Sites and Workers never create parallel member records.
 *
 * The JWT-presence check prevents an unprotected request from being promoted
 * merely by supplying the public email header.  Cloudflare Access remains the
 * outer enforcement layer and is responsible for validating that JWT.
 */
export function middleware(request: NextRequest) {
  // 司律備考目前停用：不能只隱藏入口，直接輸入網址也必須在伺服器端封鎖。
  if (request.nextUrl.pathname === "/law" || request.nextUrl.pathname.startsWith("/law/")) {
    return new NextResponse("Not Found", {
      status: 404,
      headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
    });
  }

  const requestHeaders = new Headers(request.headers);
  const cloudflareAccessHost =
    request.nextUrl.hostname === "silu-mentor.iamflashon.workers.dev";
  const existingIdentity = requestHeaders.get("oai-authenticated-user-email");
  const accessEmail = requestHeaders.get("cf-access-authenticated-user-email");
  const accessJwt = requestHeaders.get("cf-access-jwt-assertion");

  if (cloudflareAccessHost && !existingIdentity && accessEmail && accessJwt) {
    requestHeaders.set("oai-authenticated-user-email", accessEmail.trim().toLowerCase());
    requestHeaders.set("x-silu-identity-provider", "cloudflare-google");
  }

  return NextResponse.next({ request: { headers: requestHeaders } });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
