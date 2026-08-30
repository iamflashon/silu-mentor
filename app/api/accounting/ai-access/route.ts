import { requireMember } from "../../../../lib/member-auth";
import {
  accountingAiStatus,
  ACCOUNTING_AI_DAYS,
  ACCOUNTING_AI_PRICE,
  ACCOUNTING_AI_QUOTA,
} from "../../../../lib/accounting-ai-access";

export async function GET(request: Request) {
  const auth = await requireMember(request);
  if ("error" in auth) return auth.error;
  const access = await accountingAiStatus(auth.db, auth.member.id);
  return Response.json(
    {
      ...access,
      price: ACCOUNTING_AI_PRICE,
      quota: ACCOUNTING_AI_QUOTA,
      durationDays: ACCOUNTING_AI_DAYS,
    },
    { headers: { "cache-control": "no-store" } },
  );
}
