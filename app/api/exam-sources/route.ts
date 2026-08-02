import { desc } from "drizzle-orm";
import { getDb } from "../../../db";
import { examSources } from "../../../db/schema";

export async function GET() {
  try { const db = await getDb(); return Response.json({ sources: await db.select().from(examSources).orderBy(desc(examSources.createdAt)) }); }
  catch { return Response.json({ error: "真題來源尚未就緒" }, { status: 503 }); }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { url?: string; label?: string; examType?: string; sourceKind?: string };
    const url = String(body.url ?? "").trim(); const label = String(body.label ?? "").trim(); const examType = body.examType === "essay" ? "essay" : "mcq"; const sourceKind = ["exam", "regulation", "reference"].includes(String(body.sourceKind)) ? String(body.sourceKind) : "exam";
    if (!/^https:\/\//i.test(url) || !label) return Response.json({ error: "請填寫 HTTPS 網址與來源名稱" }, { status: 400 });
    const db = await getDb(); const [source] = await db.insert(examSources).values({ url, label, examType, sourceKind }).returning();
    return Response.json({ source }, { status: 201 });
  } catch { return Response.json({ error: "網址已存在或暫時無法儲存" }, { status: 409 }); }
}
