import { eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { learningResources } from "../../../../db/schema";

function isManifest(url: string, contentType = "") {
  return /\.m3u8(?:[?#].*)?$/i.test(url) || contentType.includes("mpegurl");
}

function isSafeTarget(sourceUrl: string, target: string) {
  try {
    const source = new URL(sourceUrl);
    const candidate = new URL(target);
    if (source.protocol !== "https:" || candidate.protocol !== "https:") return false;
    if (source.hostname === candidate.hostname) return true;

    // Some ibrain HLS manifests keep the playlist on one CloudFront
    // distribution but serve the AES-128 key from another. Both hosts are
    // still part of the same trusted CloudFront media path; rejecting the
    // second host makes the browser load metadata but fail to decrypt every
    // segment, which appears as a black video.
    return source.hostname.endsWith(".cloudfront.net")
      && candidate.hostname.endsWith(".cloudfront.net")
      && source.pathname.split("/").slice(0, 3).join("/") === candidate.pathname.split("/").slice(0, 3).join("/");
  } catch {
    return false;
  }
}

function proxyUrl(request: Request, resourceId: number, target: string) {
  const url = new URL(request.url);
  url.pathname = "/api/resources/media";
  url.search = "";
  url.searchParams.set("resourceId", String(resourceId));
  url.searchParams.set("target", target);
  return url.toString();
}

function rewriteManifest(body: string, baseUrl: string, request: Request, resourceId: number) {
  return body
    .split(/\r?\n/)
    .map((line) => {
      const replaceUri = (_match: string, uri: string) => {
        const absolute = new URL(uri, baseUrl).toString();
        return `URI="${proxyUrl(request, resourceId, absolute)}"`;
      };
      if (line.includes('URI="')) line = line.replace(/URI="([^"]+)"/g, replaceUri);
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) return line;
      return proxyUrl(request, resourceId, new URL(trimmed, baseUrl).toString());
    })
    .join("\n");
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const resourceId = Number(params.get("resourceId"));
  const target = params.get("target") ?? "";
  if (!resourceId || !target) return new Response("缺少影音資源", { status: 400 });

  const db = await getDb();
  const [resource] = await db.select({ sourceUrl: learningResources.sourceUrl })
    .from(learningResources)
    .where(eq(learningResources.id, resourceId))
    .limit(1);
  if (!resource?.sourceUrl || !isSafeTarget(resource.sourceUrl, target)) {
    return new Response("不允許的影音來源", { status: 403 });
  }

  const source = new URL(resource.sourceUrl);
  const headers = new Headers();
  headers.set("user-agent", "Mozilla/5.0 (compatible; SiluMentorCoursePreview/1.0)");
  // The current ibrain CloudFront distribution requires its original site
  // referrer. Keep this server-side; it is never exposed as a client secret.
  if (source.hostname.endsWith("cloudfront.net")) {
    headers.set("referer", "https://www.ibrain.com.tw/");
    headers.set("origin", "https://www.ibrain.com.tw");
  }
  for (const name of ["range", "if-none-match", "if-modified-since"]) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }

  const upstream = await fetch(target, { headers, redirect: "follow" });
  const contentType = upstream.headers.get("content-type") ?? "";
  if (!upstream.ok) {
    return new Response(`影音來源回應 ${upstream.status}`, {
      status: upstream.status,
      headers: { "cache-control": "no-store" },
    });
  }

  const responseHeaders = new Headers();
  responseHeaders.set("access-control-allow-origin", "*");
  responseHeaders.set("access-control-expose-headers", "content-length,content-range,accept-ranges");
  responseHeaders.set("cache-control", "public, max-age=60");
  if (contentType) responseHeaders.set("content-type", contentType);
  for (const name of ["content-length", "content-range", "accept-ranges", "etag"]) {
    const value = upstream.headers.get(name);
    if (value) responseHeaders.set(name, value);
  }

  if (isManifest(target, contentType)) {
    const body = rewriteManifest(await upstream.text(), target, request, resourceId);
    responseHeaders.set("content-type", "application/vnd.apple.mpegurl");
    responseHeaders.delete("content-length");
    return new Response(body, { status: 200, headers: responseHeaders });
  }

  return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
}
