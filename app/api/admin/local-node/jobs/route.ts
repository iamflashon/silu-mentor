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
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const sourceFile = safeSourceFile(body.sourceFile);
  if (!sourceFile) return Response.json({ error: "請輸入 inbox 內的完整檔名，不可包含資料夾路徑" }, { status: 400 });
  const jobs = await readLocalNodeJobs();
  const existing = jobs.find((job) => job.sourceFile.toLowerCase() === sourceFile.toLowerCase() && ["queued", "claimed"].includes(job.status));
  if (existing) return Response.json({ job: existing, existing: true });
  const allowedCategories = ["law", "accounting", "medtech", "data-structure"] as const;
  const examCategory = allowedCategories.includes(body.examCategory as typeof allowedCategories[number]) ? body.examCategory as typeof allowedCategories[number] : "law";
  const clean = (value: unknown, fallback: string, max = 100) => typeof value === "string" && value.trim() ? value.trim().slice(0, max) : fallback;
  const subject = clean(body.subject, examCategory === "accounting" ? "中級會計" : examCategory === "medtech" ? "醫檢師" : examCategory === "data-structure" ? "資料結構" : "法律");
  const documentType = clean(body.documentType, "核心教材");
  const bookTitle = clean(body.bookTitle, sourceFile.replace(/\.[^.]+$/u, ""), 180);
  const job: LocalNodeJob = { id: crypto.randomUUID(), sourceFile, kind: "extract_text", status: "queued", createdAt: new Date().toISOString(), message: "等待公司本機領取", examCategory, subject, documentType, bookTitle, indexStatus: "queued" };
  jobs.unshift(job);
  await writeLocalNodeJobs(jobs);
  return Response.json({ job }, { status: 201 });
}
