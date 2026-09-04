import { consumeLegalSearch } from "../../../../lib/legal-search-access";
import { simulateJudicialResearch } from "../../../../lib/judicial-research-simulator";

export async function POST(request: Request) {
  let body: { question?: unknown } = {};
  try { body = await request.json() as { question?: unknown }; } catch { /* handled below */ }
  const question = typeof body.question === "string" ? body.question.trim().slice(0, 240) : "";
  if (question.length < 2) return Response.json({ error: "請輸入一個完整法律問題。" }, { status: 400 });
  const auth = await consumeLegalSearch(request);
  if ("error" in auth) return auth.error;
  if ("exhausted" in auth && auth.exhausted) return Response.json({ error: "本帳號的 100 次測試額度已用完，請提出臨時調高申請。", code: "LEGAL_SEARCH_LIMIT", access: { metered: true, used: auth.used, limit: auth.limit, remaining: 0, temporaryExpiresAt: auth.temporaryExpiresAt } }, { status: 429 });
  try {
    return Response.json({ ...(await simulateJudicialResearch(question)), access: { metered: auth.metered, used: auth.used, limit: auth.limit, remaining: auth.remaining, temporaryExpiresAt: auth.temporaryExpiresAt } }, { headers: { "cache-control": "no-store" } });
  } catch {
    return Response.json({ error: "裁判資料尚未就緒，請稍後再測試。" }, { status: 503 });
  }
}
