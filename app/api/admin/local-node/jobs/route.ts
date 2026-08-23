import { requireAdmin } from "../../../../../lib/member-auth";
import { LocalNodeJob, readLocalNodeJobs, safeSourceFile, writeLocalNodeJobs } from "../../../../../lib/local-node-jobs";

export async function GET(request: Request) {
  const auth = await requireAdmin(request);
  if ("error" in auth) return auth.error;
  return Response.json({ jobs: await readLocalNodeJobs() }, { headers: { "cache-control": "no-store" } });
}

export async function POST(request: Request) {
  const auth = await requireAdmin(request);
  if ("error" in auth) return auth.error;
  const body = await request.json().catch(() => ({})) as { sourceFile?: unknown };
  const sourceFile = safeSourceFile(body.sourceFile);
  if (!sourceFile) return Response.json({ error: "請輸入 inbox 內的完整檔名，不可包含資料夾路徑" }, { status: 400 });
  const jobs = await readLocalNodeJobs();
  const existing = jobs.find((job) => job.sourceFile.toLowerCase() === sourceFile.toLowerCase() && ["queued", "claimed"].includes(job.status));
  if (existing) return Response.json({ job: existing, existing: true });
  const job: LocalNodeJob = { id: crypto.randomUUID(), sourceFile, kind: "extract_text", status: "queued", createdAt: new Date().toISOString(), message: "等待公司本機領取" };
  jobs.unshift(job);
  await writeLocalNodeJobs(jobs);
  return Response.json({ job }, { status: 201 });
}
