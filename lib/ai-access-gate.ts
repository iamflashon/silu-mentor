import { getDb } from "../db";
import {
  getActiveAiEntitlement,
  getAiPlan,
  getUnexpiredAiEntitlement,
  consumeAiAccess,
  progressAiCoach,
  canUseCoachWebSearch,
  recordCoachWebSearch,
} from "./ai-access";
import { requireMember } from "./member-auth";

export type AiUseGate =
  | { metered: false; memberId: null; db: Awaited<ReturnType<typeof getDb>> }
  | {
      metered: true;
      memberId: number;
      category: string;
      db: Awaited<ReturnType<typeof getDb>>;
    };

export async function prepareAiUse(
  request: Request,
  category: string,
): Promise<AiUseGate | Response> {
  const db = await getDb();
  const plan = await getAiPlan(db);
  const auth = await requireMember(request);
  if ("error" in auth) return auth.error;
  const entitlement = await getActiveAiEntitlement(
    auth.db,
    auth.member.id,
    new Date(),
    category,
  );
  const unexpiredEntitlement =
    entitlement ??
    (await getUnexpiredAiEntitlement(
      auth.db,
      auth.member.id,
      new Date(),
      category,
    ));
  // 已兌換或購買的有效方案一律依剩餘次數計費。不能因後台暫停販售，
  // 就把既有方案誤判成不限次使用。
  if (entitlement)
    return { metered: true, memberId: auth.member.id, category, db: auth.db };
  if (unexpiredEntitlement) {
    return Response.json(
      {
        error: "AI 使用次數已用完，請購買新一期方案或輸入啟用碼。",
        code: "AI_ACCESS_REQUIRED",
        purchaseUrl: "/account#ai-access",
      },
      { status: 402 },
    );
  }
  if (!plan.enabled || !plan.categories.includes(category))
    return { metered: false, memberId: null, db };
  // 管理員平常測試不計次；若主動兌換／購買有效方案，就視同學生計次，
  // 讓管理員能完整驗證前台輪次與扣除流程。
  if (auth.member.canAdmin)
    return { metered: false, memberId: auth.member.id, db: auth.db };
  return Response.json(
    {
      error:
        "本次 AI 試問方案尚未啟用、已到期或次數已用完，請購買新一期方案或輸入啟用碼。",
      code: "AI_ACCESS_REQUIRED",
      purchaseUrl: "/account#ai-access",
    },
    { status: 402 },
  );
}

export async function finishAiUse(
  gate: AiUseGate,
  input: {
    action: string;
    description: string;
    requestKey?: string;
    quantity?: number;
  },
) {
  if (!gate.metered || !gate.memberId)
    return { charged: false, remaining: null };
  const result = await consumeAiAccess(gate.db, {
    memberId: gate.memberId,
    category: gate.category,
    ...input,
  });
  if (!result.charged && !result.idempotent)
    throw new Error("AI 額度已用完，請購買新一期方案或輸入啟用碼。");
  return result;
}

export async function finishAiCoachRound(
  gate: AiUseGate,
  input: { action: string; description: string; requestKey?: string },
) {
  if (!gate.metered || !gate.memberId) {
    const plan = await getAiPlan(gate.db);
    return {
      charged: false,
      remaining: null,
      coachRoundsUsed: null,
      coachRoundsTarget: plan.coachRounds,
    };
  }
  const plan = await getAiPlan(gate.db),
    result = await progressAiCoach(gate.db, {
      memberId: gate.memberId,
      category: gate.category,
      roundTarget: plan.coachRounds,
      ...input,
    });
  if (!result.idempotent && result.remaining === 0 && !result.charged)
    throw new Error("AI 額度已用完，請購買新一期方案或輸入啟用碼。");
  return result;
}

export async function coachWebSearchAvailable(gate: AiUseGate) {
  if (!gate.metered || !gate.memberId) return true;
  return canUseCoachWebSearch(gate.db, gate.memberId);
}
export async function markCoachWebSearchUsed(gate: AiUseGate) {
  if (gate.metered && gate.memberId)
    await recordCoachWebSearch(gate.db, gate.memberId);
}
