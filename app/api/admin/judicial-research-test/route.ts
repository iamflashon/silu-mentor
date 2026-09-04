import { requireAdmin } from "../../../../lib/member-auth";
import { simulateJudicialResearch } from "../../../../lib/judicial-research-simulator";

export async function POST(request: Request) {
  const auth = await requireAdmin(request);
  if ("error" in auth) return auth.error;
  let body: { question?: unknown } = {};
  try { body = await request.json() as { question?: unknown }; } catch { /* handled below */ }
  const question = typeof body.question === "string" ? body.question.trim().slice(0, 240) : "";
  if (question.length < 2) return Response.json({ error: "請輸入一個完整法律問題。" }, { status: 400 });
  try {
    return Response.json(await simulateJudicialResearch(question), { headers: { "cache-control": "no-store" } });
  } catch {
    return Response.json({ error: "裁判資料尚未就緒，請稍後再測試。" }, { status: 503 });
  }
}
