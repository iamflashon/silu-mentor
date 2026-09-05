import { isLegalQuestionPersona } from "../../../../lib/legal-question-bank";
import { legalQuestionHistory, legalResearchRunDetail, nextUnaskedQuestion } from "../../../../lib/legal-question-history";
import { requireMember } from "../../../../lib/member-auth";

export async function GET(request: Request) {
  const auth = await requireMember(request);
  if ("error" in auth) return auth.error;
  const runId = Number(new URL(request.url).searchParams.get("run_id") ?? 0);
  if (Number.isInteger(runId) && runId > 0) {
    const run = await legalResearchRunDetail(auth.member.id, runId);
    return run ? Response.json(run, { headers: { "cache-control": "no-store" } }) : Response.json({ error: "找不到這筆研究紀錄。" }, { status: 404 });
  }
  return Response.json(await legalQuestionHistory(auth.member.id), { headers: { "cache-control": "no-store" } });
}

export async function POST(request: Request) {
  const auth = await requireMember(request);
  if ("error" in auth) return auth.error;
  const body = await request.json().catch(() => ({})) as { persona?: unknown; exclude?: unknown };
  const persona = typeof body.persona === "string" ? body.persona : "";
  if (!isLegalQuestionPersona(persona)) return Response.json({ error: "未知的使用者身分。" }, { status: 400 });
  const exclude = Array.isArray(body.exclude) ? body.exclude.filter((item): item is string => typeof item === "string").slice(0, 12) : [];
  return Response.json(await nextUnaskedQuestion(auth.member.id, persona, exclude), { headers: { "cache-control": "no-store" } });
}
