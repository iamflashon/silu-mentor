import { and, eq, gt } from "drizzle-orm";
import { getDb } from "../../../../db";
import { learningResources, members, posnerCourseEntitlements, posnerCourseProducts } from "../../../../db/schema";
import { authenticatedEmail } from "../../../../lib/member-auth";

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

function previewManifest(body:string,start:number,duration:number){
  if(duration<=0)return "#EXTM3U\n#EXT-X-ENDLIST\n";
  const lines=body.split(/\r?\n/),out:string[]=[],headers:string[]=[];let elapsed=0,sequence=0,firstSequence=0,picked=false;
  for(let i=0;i<lines.length;i++){const line=lines[i];if(line.startsWith("#EXT-X-MEDIA-SEQUENCE:"))firstSequence=Number(line.split(":")[1])||0;else if(line.startsWith("#EXT-X-")&&!line.startsWith("#EXT-X-ENDLIST")&&!line.startsWith("#EXTINF"))headers.push(line);if(line.startsWith("#EXTINF:")){const len=Number(line.slice(8).split(",")[0])||0,uri=lines[i+1]||"",segmentStart=elapsed,segmentEnd=elapsed+len;if(segmentEnd>start&&segmentStart<start+duration){if(!picked){out.push("#EXTM3U",...headers.filter(x=>!x.startsWith("#EXT-X-MEDIA-SEQUENCE:")),`#EXT-X-MEDIA-SEQUENCE:${firstSequence+sequence}`);picked=true}out.push(line,uri)}elapsed=segmentEnd;sequence++;i++}}
  return [...out,"#EXT-X-ENDLIST"].join("\n");
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const resourceId = Number(params.get("resourceId"));
  const target = params.get("target") ?? "";
  if (!resourceId || !target) return new Response("缺少影音資源", { status: 400 });

  const db = await getDb();
  const [resource] = await db.select({ sourceUrl: learningResources.sourceUrl, accessType:learningResources.accessType })
    .from(learningResources)
    .where(eq(learningResources.id, resourceId))
    .limit(1);
  if (!resource?.sourceUrl || !isSafeTarget(resource.sourceUrl, target)) {
    return new Response("不允許的影音來源", { status: 403 });
  }
  let preview:null|{start:number;duration:number}=null;
  if(resource.accessType==="posner"){
    const [product]=await db.select().from(posnerCourseProducts).where(eq(posnerCourseProducts.resourceId,resourceId)).limit(1);
    const email=authenticatedEmail(request);let entitled=false;
    if(email){const [member]=await db.select({id:members.id}).from(members).where(eq(members.email,email)).limit(1);if(member){const [access]=await db.select({id:posnerCourseEntitlements.id}).from(posnerCourseEntitlements).where(and(eq(posnerCourseEntitlements.memberId,member.id),eq(posnerCourseEntitlements.resourceId,resourceId),eq(posnerCourseEntitlements.status,"active"),gt(posnerCourseEntitlements.expiresAt,new Date()))).limit(1);entitled=Boolean(access)}}
    if(!entitled)preview={start:product?.previewStartSeconds??0,duration:product?.previewDurationSeconds??300};
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
  responseHeaders.set("cache-control", preview ? "private, no-store" : "public, max-age=60");
  if (contentType) responseHeaders.set("content-type", contentType);
  for (const name of ["content-length", "content-range", "accept-ranges", "etag"]) {
    const value = upstream.headers.get(name);
    if (value) responseHeaders.set(name, value);
  }

  if (isManifest(target, contentType)) {
    const original=await upstream.text();
    const body = rewriteManifest(preview ? previewManifest(original,preview.start,preview.duration) : original, target, request, resourceId);
    responseHeaders.set("content-type", "application/vnd.apple.mpegurl");
    responseHeaders.delete("content-length");
    return new Response(body, { status: 200, headers: responseHeaders });
  }

  return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
}
