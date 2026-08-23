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

export async function GET(request: Request) {
  if (!(await authorized(request))) return Response.json({ error: "本機節點驗證失敗" }, { status: 401 });
  const jobs = await readLocalNodeJobs();
  const job = jobs.find((item) => item.status === "queued");
  if (!job) return new Response(null, { status: 204 });
  job.status = "claimed"; job.claimedAt = new Date().toISOString(); job.message = "公司本機處理中";
  await writeLocalNodeJobs(jobs);
  return Response.json({ job }, { headers: { "cache-control": "no-store" } });
}

export async function POST(request: Request) {
  if (!(await authorized(request))) return Response.json({ error: "本機節點驗證失敗" }, { status: 401 });
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const jobId = typeof body.jobId === "string" ? body.jobId : "";
  const jobs = await readLocalNodeJobs();
  const job = jobs.find((item) => item.id === jobId);
  if (!job) return Response.json({ error: "找不到本機工作" }, { status: 404 });
  const ok = body.status === "completed";
  job.status = ok ? "completed" : "failed";
  job.completedAt = new Date().toISOString();
  job.nodeId = typeof body.nodeId === "string" ? body.nodeId.slice(0, 80) : "company-rtx4090";
  job.message = typeof body.message === "string" ? body.message.slice(0, 240) : ok ? "本機處理完成" : "本機處理失敗";
  if (ok) {
    const chunks = Array.isArray(body.chunks) ? body.chunks.filter((item): item is string => typeof item === "string").map((item) => item.slice(0, 12000)).slice(0, 500) : [];
    const result = { jobId, sourceFile: job.sourceFile, extractedAt: job.completedAt, sha256: typeof body.sha256 === "string" ? body.sha256.slice(0, 128) : "", pageCount: Number.isFinite(Number(body.pageCount)) ? Number(body.pageCount) : null, chunks };
    const bytes = new TextEncoder().encode(JSON.stringify(result));
    if (bytes.byteLength > 6_000_000) return Response.json({ error: "文字結果超過 6MB，請調低切片數量" }, { status: 413 });
    const { env } = await import("cloudflare:workers");
    const key = `local-node-results/${job.id}.json`;
    await env.BUCKET.put(key, bytes, { httpMetadata: { contentType: "application/json; charset=utf-8" }, customMetadata: { sourceFile: job.sourceFile, originalUploaded: "false" } });
    job.resultKey = key; job.extractedChars = chunks.reduce((sum, item) => sum + item.length, 0); job.chunkCount = chunks.length; job.pageCount = result.pageCount;
  }
  await writeLocalNodeJobs(jobs);
  return Response.json({ ok: true, job });
}
