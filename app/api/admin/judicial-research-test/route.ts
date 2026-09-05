import { consumeLegalSearch } from "../../../../lib/legal-search-access";
import { simulateJudicialResearch } from "../../../../lib/judicial-research-simulator";
import { recordLegalQuestion, recordLegalResearchRun } from "../../../../lib/legal-question-history";

export async function POST(request: Request) {
  let body: { question?: unknown; persona?: unknown; source?: unknown } = {};
  try { body = await request.json() as { question?: unknown; persona?: unknown; source?: unknown }; } catch { /* handled below */ }
  const question = typeof body.question === "string" ? body.question.trim().slice(0, 240) : "";
  if (question.length < 2) return Response.json({ error: "請輸入一個完整法律問題。" }, { status: 400 });
  const auth = await consumeLegalSearch(request);
  if ("error" in auth) return auth.error;
  if ("exhausted" in auth && auth.exhausted) return Response.json({ error: "本帳號的 100 次測試額度已用完，請提出臨時調高申請。", code: "LEGAL_SEARCH_LIMIT", access: { metered: true, used: auth.used, limit: auth.limit, remaining: 0, temporaryExpiresAt: auth.temporaryExpiresAt } }, { status: 429 });
  const persona = typeof body.persona === "string" ? body.persona.slice(0, 30) : "";
  const source = body.source === "persona" ? "persona" : "custom";
  await recordLegalQuestion(auth.member.id, question, persona, source).catch(error => console.error("[legal-question-history] question save failed", error));
  try {
    const result = await simulateJudicialResearch(question);
    const savedResult = await recordLegalResearchRun(auth.member.id, question, persona, source, result).catch(error => { console.error("[legal-question-history] research save failed", error); return result; });
    return Response.json({ ...savedResult, access: { metered: auth.metered, used: auth.used, limit: auth.limit, remaining: auth.remaining, temporaryExpiresAt: auth.temporaryExpiresAt } }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    console.error("[judicial-research-test] failed", error);
    await recordLegalResearchRun(auth.member.id, question, persona, source, {}, "failed", error instanceof Error ? error.message : "unknown error").catch(saveError => console.error("[legal-question-history] failed-run save failed", saveError));
    return Response.json({ error: "研究搜尋暫時未完成；已入庫的裁判資料仍可搜尋，請稍後再試。" }, { status: 503 });
  }
}
