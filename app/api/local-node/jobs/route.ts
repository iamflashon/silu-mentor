import { readLocalNodeJobs, writeLocalNodeJobs } from "../../../../lib/local-node-jobs";
import { getDb } from "../../../../db";
import { documents, learningResources, resourceSegments } from "../../../../db/schema";
import { and, eq } from "drizzle-orm";
import { decodeSubtitle, parseSrt } from "../../../../lib/srt";

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
  const staleBefore = Date.now() - 10 * 60 * 1000;
  let released = false;
  for (const item of jobs) {
    if (item.status !== "claimed") continue;
    const lastActivity = Date.parse(item.progressUpdatedAt ?? item.claimedAt ?? item.createdAt);
    if (Number.isFinite(lastActivity) && lastActivity < staleBefore) {
      item.status = "queued";
      item.claimedAt = undefined;
      item.progressPercent = 0;
      item.progressStage = "等待重新處理";
      item.message = "先前處理逾時，已自動交回本機佇列";
      item.elapsedSeconds = undefined;
      item.estimatedRemainingSeconds = undefined;
      released = true;
    }
  }
  const job = jobs.find((item) => item.status === "queued");
  if (!job) {
    if (released) await writeLocalNodeJobs(jobs);
    return new Response(null, { status: 204 });
  }
  job.status = "claimed"; job.claimedAt = new Date().toISOString(); job.message = "公司本機處理中";
  await writeLocalNodeJobs(jobs);
  return Response.json({ job }, { headers: { "cache-control": "no-store" } });
}

export async function POST(request: Request, context?: { waitUntil?: (promise: Promise<unknown>) => void }) {
  if (!(await authorized(request))) return Response.json({ error: "本機節點驗證失敗" }, { status: 401 });
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const jobId = typeof body.jobId === "string" ? body.jobId : "";
  const jobs = await readLocalNodeJobs();
  const job = jobs.find((item) => item.id === jobId);
  if (!job) return Response.json({ error: "找不到本機工作" }, { status: 404 });
  if (body.status === "progress") {
    job.status = "claimed";
    job.nodeId = typeof body.nodeId === "string" ? body.nodeId.slice(0, 80) : "company-rtx4090";
    job.progressPercent = Math.min(99, Math.max(0, Math.round(Number(body.progressPercent) || 0)));
    job.progressStage = typeof body.progressStage === "string" ? body.progressStage.slice(0, 80) : "本機處理中";
    job.message = typeof body.message === "string" ? body.message.slice(0, 240) : job.progressStage;
    job.elapsedSeconds = Math.max(0, Math.round(Number(body.elapsedSeconds) || 0));
    job.estimatedRemainingSeconds = Math.max(0, Math.round(Number(body.estimatedRemainingSeconds) || 0));
    job.progressUpdatedAt = new Date().toISOString();
    await writeLocalNodeJobs(jobs);
    return Response.json({ ok: true, job });
  }
  const ok = body.status === "completed";
  job.status = ok ? "completed" : "failed";
  job.completedAt = new Date().toISOString();
  job.nodeId = typeof body.nodeId === "string" ? body.nodeId.slice(0, 80) : "company-rtx4090";
  job.message = typeof body.message === "string" ? body.message.slice(0, 240) : ok ? "本機處理完成" : "本機處理失敗";
  job.progressPercent = ok ? 100 : job.progressPercent;
  job.progressStage = ok ? "處理完成" : "處理失敗";
  if (ok && job.kind === "transcode_video" && job.resourceId) {
    job.hlsKey = typeof body.hlsKey === "string" ? body.hlsKey.slice(0, 300) : `${job.mediaPrefix}/index.m3u8`;
    job.posterKey = typeof body.posterKey === "string" ? body.posterKey.slice(0, 300) : undefined;
    job.subtitleKey = typeof body.subtitleKey === "string" ? body.subtitleKey.slice(0, 300) : undefined;
    job.durationSeconds = Math.max(0, Number(body.durationSeconds) || 0);
    job.segmentCount = Math.max(0, Math.floor(Number(body.segmentCount) || 0));
    const playbackUrl = new URL(`/api/course-media/${job.resourceId}/index.m3u8`, request.url).toString();
    const db = await getDb("primary");
    await db.update(learningResources).set({ sourceUrl: playbackUrl, description: `本機 HLS 已完成，共 ${job.segmentCount} 個切片${job.subtitleKey ? "，含字幕" : ""}`, status: "draft", updatedAt: new Date() }).where(eq(learningResources.id, job.resourceId));
    if (job.subtitleKey) {
      try {
        const { env } = await import("cloudflare:workers");
        const subtitle = await env.BUCKET.get(job.subtitleKey);
        if (subtitle) {
          // Store study-sized subtitle sections instead of every tiny Whisper cue.
          // Long lessons can contain thousands of cues, which previously made
          // the completion request exceed the local node's network timeout.
          const cues = parseSrt(decodeSubtitle(await subtitle.arrayBuffer()));
          if (cues.length) {
            await db.delete(resourceSegments).where(and(eq(resourceSegments.resourceId, job.resourceId), eq(resourceSegments.segmentType, "subtitle")));
            const rows = cues.map((cue, index) => ({ resourceId: job.resourceId!, segmentType: "subtitle", lessonLabel: job.sourceFile.replace(/\.[^.]+$/, ""), title: `${Math.floor(cue.start / 60)}:${String(Math.floor(cue.start % 60)).padStart(2, "0")}－${Math.floor(cue.end / 60)}:${String(Math.floor(cue.end % 60)).padStart(2, "0")}`, startSeconds: cue.start, endSeconds: cue.end, text: cue.text, reviewStatus: "pending", sequence: index + 1 }));
            for (let index = 0; index < rows.length; index += 4) await db.insert(resourceSegments).values(rows.slice(index, index + 4));
            const digestRequest = new Request(new URL("/api/resources/segments", request.url), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ resourceId: job.resourceId, action: "digest" }) });
            const digestTask = fetch(digestRequest).then(async (response) => { if (!response.ok) console.error(`[local-node/jobs] automatic digest failed: ${response.status} ${(await response.text()).slice(0, 300)}`); });
            if (context?.waitUntil) context.waitUntil(digestTask); else await digestTask;
          }
        }
      } catch (error) {
        console.error(`[local-node/jobs] subtitle import failed: ${error instanceof Error ? error.message.slice(0, 500) : "unknown error"}`);
      }
    }
    await writeLocalNodeJobs(jobs);
    return Response.json({ ok: true, job, playbackUrl });
  }
  if (ok) {
    const chunks = Array.isArray(body.chunks) ? body.chunks.map((item, index) => typeof item === "string" ? { text: item, sequence: index + 1, pageStart: null, pageEnd: null } : item && typeof item === "object" ? { text: String((item as Record<string, unknown>).text ?? "").slice(0, 12000), sequence: Number((item as Record<string, unknown>).sequence ?? index + 1), pageStart: Number((item as Record<string, unknown>).pageStart) || null, pageEnd: Number((item as Record<string, unknown>).pageEnd) || null } : null).filter((item): item is { text:string; sequence:number; pageStart:number|null; pageEnd:number|null } => Boolean(item?.text)).slice(0, 500) : [];
    const pageCount = Number.isFinite(Number(body.pageCount)) ? Number(body.pageCount) : null;
    const jsonl = chunks.map((chunk) => JSON.stringify({ title: job.bookTitle, source: job.sourceFile, category: job.examCategory, subject: job.subject, document_type: job.documentType, section: `文字切片 ${chunk.sequence}`, sequence: chunk.sequence, page_start: chunk.pageStart, page_end: chunk.pageEnd, text: chunk.text })).join("\n");
    const bytes = new TextEncoder().encode(jsonl);
    if (bytes.byteLength > 6_000_000) return Response.json({ error: "文字結果超過 6MB，請調低切片數量" }, { status: 413 });
    const { env } = await import("cloudflare:workers");
    const key = `local-node-results/${job.id}.jsonl`;
    await env.BUCKET.put(key, bytes, { httpMetadata: { contentType: "application/jsonl; charset=utf-8" }, customMetadata: { sourceFile: job.sourceFile, originalUploaded: "false", examCategory: job.examCategory } });
    const db = await getDb("primary");
    const [created] = await db.insert(documents).values({ storageKey: key, fileName: `${job.sourceFile}.local-index.jsonl`, contentType: "application/jsonl", sizeBytes: bytes.byteLength, examCategory: job.examCategory, bookTitle: job.bookTitle, subject: job.subject, documentType: job.documentType, status: "uploaded", processingStage: "queued", processingMessage: "公司本機擷取完成；等待建立全文／向量索引", processingResultJson: JSON.stringify({ localNodeJobId: job.id, originalFileName: job.sourceFile, originalStoredLocally: true, extractionMode: String(body.extractionMode ?? "local") }), pageCount }).returning({ id: documents.id });
    job.resultKey = key; job.extractedChars = chunks.reduce((sum, item) => sum + item.text.length, 0); job.chunkCount = chunks.length; job.pageCount = pageCount; job.documentId = created?.id; job.indexStatus = "queued";
  }
  await writeLocalNodeJobs(jobs);
  return Response.json({ ok: true, job });
}
