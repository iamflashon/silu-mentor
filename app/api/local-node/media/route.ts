import { readLocalNodeJobs, writeLocalNodeJobs } from "../../../../lib/local-node-jobs";

async function authorized(request: Request) {
  const { env } = await import("cloudflare:workers");
  const expected = String((env as typeof env & { LOCAL_NODE_TOKEN?: string }).LOCAL_NODE_TOKEN ?? "").trim();
  const header = request.headers.get("authorization") ?? "";
  const received = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
  if (!expected || !received) return false;
  const encoder = new TextEncoder();
  const [a, b] = await Promise.all([crypto.subtle.digest("SHA-256", encoder.encode(expected)), crypto.subtle.digest("SHA-256", encoder.encode(received))]);
  const left = new Uint8Array(a); const right = new Uint8Array(b);
  let mismatch = left.length ^ right.length;
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) mismatch |= (left[index] ?? 0) ^ (right[index] ?? 0);
  return mismatch === 0;
}

function safeMediaPath(value: string) {
  if (!/^(?:index\.m3u8|poster\.jpg|transcript\.srt|subtitles\.vtt|metadata\.json|segment-\d{5}\.ts)$/i.test(value)) return "";
  return value;
}

export async function PUT(request: Request) {
  if (!(await authorized(request))) return Response.json({ error: "本機節點驗證失敗" }, { status: 401 });
  const url = new URL(request.url);
  const jobId = url.searchParams.get("jobId") ?? "";
  const mediaPath = safeMediaPath(url.searchParams.get("path") ?? "");
  if (!jobId || !mediaPath || !request.body) return Response.json({ error: "影音上傳資料不完整" }, { status: 400 });
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > 25 * 1024 * 1024) return Response.json({ error: "單一影音切片不可超過 25MB" }, { status: 413 });
  const jobs = await readLocalNodeJobs();
  const job = jobs.find((item) => item.id === jobId && item.kind === "transcode_video" && item.status === "claimed");
  if (!job?.resourceId) return Response.json({ error: "找不到可上傳的影音工作" }, { status: 404 });
  const prefix = `course-media/${job.resourceId}/${job.id}`;
  const key = `${prefix}/${mediaPath}`;
  const contentType = mediaPath.endsWith(".m3u8") ? "application/vnd.apple.mpegurl" : mediaPath.endsWith(".ts") ? "video/mp2t" : mediaPath.endsWith(".jpg") ? "image/jpeg" : mediaPath.endsWith(".vtt") ? "text/vtt; charset=utf-8" : mediaPath.endsWith(".srt") ? "application/x-subrip; charset=utf-8" : "application/json; charset=utf-8";
  const { env } = await import("cloudflare:workers");
  await env.BUCKET.put(key, request.body, { httpMetadata: { contentType }, customMetadata: { jobId, resourceId: String(job.resourceId), private: "true" } });
  if (!job.mediaPrefix) {
    job.mediaPrefix = prefix;
    await writeLocalNodeJobs(jobs);
  }
  return Response.json({ ok: true, key });
}
