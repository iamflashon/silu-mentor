import { isLegalQuestionPersona } from "../../../../lib/legal-question-bank";
import { legalQuestionHistory, nextUnaskedQuestion } from "../../../../lib/legal-question-history";
import { requireMember } from "../../../../lib/member-auth";

export async function GET(request: Request) {
  const auth = await requireMember(request);
  if ("error" in auth) return auth.error;
  return Response.json(await legalQuestionHistory(auth.member.id), { headers: { "cache-control": "no-store" } });
}

export async function POST(request: Request) {
  const auth = await requireMember(request);
  if ("error" in auth) return auth.error;
  const body = await request.json().catch(() => ({})) as { persona?: unknown };
  const persona = typeof body.persona === "string" ? body.persona : "";
  if (!isLegalQuestionPersona(persona)) return Response.json({ error: "未知的使用者身分。" }, { status: 400 });
  return Response.json(await nextUnaskedQuestion(auth.member.id, persona), { headers: { "cache-control": "no-store" } });
}
