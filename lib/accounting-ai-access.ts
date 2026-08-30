import { and, eq, gt, lt, lte, sql } from "drizzle-orm";
import type { getDb } from "../db";
import { accountingAiEntitlements, accountingAiLedger } from "../db/schema";
import { requireMember } from "./member-auth";

type Db = Awaited<ReturnType<typeof getDb>>;
export const ACCOUNTING_AI_PRICE = 30;
export const ACCOUNTING_AI_QUOTA = 30;
export const ACCOUNTING_AI_DAYS = 30;

export async function accountingAiStatus(db: Db, memberId: number) {
  const now = new Date();
  const [row] = await db
    .select()
    .from(accountingAiEntitlements)
    .where(
      and(
        eq(accountingAiEntitlements.memberId, memberId),
        eq(accountingAiEntitlements.status, "active"),
        gt(accountingAiEntitlements.expiresAt, now),
      ),
    )
    .limit(1);
  return row
    ? {
        active: row.quotaUsed < row.quotaTotal,
        quotaTotal: row.quotaTotal,
        quotaUsed: row.quotaUsed,
        remaining: Math.max(0, row.quotaTotal - row.quotaUsed),
        expiresAt: row.expiresAt.toISOString(),
      }
    : {
        active: false,
        quotaTotal: 0,
        quotaUsed: 0,
        remaining: 0,
        expiresAt: null,
      };
}

export async function consumeAccountingAi(
  db: Db,
  memberId: number,
  requestKey: string,
) {
  const key = requestKey.slice(0, 120);
  const [existing] = await db
    .select()
    .from(accountingAiLedger)
    .where(
      and(
        eq(accountingAiLedger.memberId, memberId),
        eq(accountingAiLedger.requestKey, key),
      ),
    )
    .limit(1);
  if (existing)
    return {
      charged: false,
      remaining: existing.balanceAfter,
      idempotent: true,
    };
  const now = new Date();
  const [entitlement] = await db
    .select()
    .from(accountingAiEntitlements)
    .where(
      and(
        eq(accountingAiEntitlements.memberId, memberId),
        eq(accountingAiEntitlements.status, "active"),
        gt(accountingAiEntitlements.expiresAt, now),
        lt(
          accountingAiEntitlements.quotaUsed,
          accountingAiEntitlements.quotaTotal,
        ),
      ),
    )
    .limit(1);
  if (!entitlement) return null;
  const [updated] = await db
    .update(accountingAiEntitlements)
    .set({
      quotaUsed: sql`${accountingAiEntitlements.quotaUsed} + 1`,
      updatedAt: now,
    })
    .where(
      and(
        eq(accountingAiEntitlements.id, entitlement.id),
        lte(
          accountingAiEntitlements.quotaUsed,
          sql`${accountingAiEntitlements.quotaTotal} - 1`,
        ),
      ),
    )
    .returning();
  if (!updated) return null;
  const remaining = Math.max(0, updated.quotaTotal - updated.quotaUsed);
  await db.insert(accountingAiLedger).values({
    entitlementId: updated.id,
    memberId,
    requestKey: key,
    balanceAfter: remaining,
  });
  return { charged: true, remaining, idempotent: false };
}

export async function grantAccountingAi(
  db: Db,
  memberId: number,
  referenceId: string,
  options?: { quota?: number; durationDays?: number },
) {
  const quota = Math.max(1, Math.floor(options?.quota ?? ACCOUNTING_AI_QUOTA));
  const durationDays = Math.max(
    1,
    Math.floor(options?.durationDays ?? ACCOUNTING_AI_DAYS),
  );
  const now = new Date();
  const [current] = await db
    .select()
    .from(accountingAiEntitlements)
    .where(eq(accountingAiEntitlements.memberId, memberId))
    .limit(1);
  const base =
    current?.expiresAt && current.expiresAt > now ? current.expiresAt : now;
  const expiresAt = new Date(base.getTime() + durationDays * 86400000);
  const values = {
    memberId,
    quotaTotal: quota,
    quotaUsed: 0,
    status: "active",
    startsAt: now,
    expiresAt,
    source: "line_pay",
    referenceId,
    updatedAt: now,
  };
  if (!current)
    return (
      await db.insert(accountingAiEntitlements).values(values).returning()
    )[0];
  return (
    await db
      .update(accountingAiEntitlements)
      .set({
        quotaTotal: sql`${accountingAiEntitlements.quotaTotal} + ${quota}`,
        status: "active",
        expiresAt,
        source: "line_pay",
        referenceId,
        updatedAt: now,
      })
      .where(eq(accountingAiEntitlements.id, current.id))
      .returning()
  )[0];
}

export async function prepareAccountingAiUse(request: Request) {
  const auth = await requireMember(request);
  if ("error" in auth) return auth.error;
  const status = await accountingAiStatus(auth.db, auth.member.id);
  if (status.active)
    return { metered: true as const, db: auth.db, memberId: auth.member.id };
  if (auth.member.canAdmin)
    return { metered: false as const, db: auth.db, memberId: auth.member.id };
  return Response.json(
    {
      error: "中會課業答疑次數已用完，請購買中會專用方案。",
      code: "ACCOUNTING_AI_REQUIRED",
      purchaseUrl: "/accounting/qa#accounting-ai-purchase",
    },
    { status: 402 },
  );
}

export async function finishAccountingAiUse(gate: {
  metered: boolean;
  db: Db;
  memberId: number;
}) {
  if (!gate.metered) return { charged: false, remaining: null };
  const result = await consumeAccountingAi(
    gate.db,
    gate.memberId,
    crypto.randomUUID(),
  );
  if (!result) throw new Error("中會課業答疑次數已用完，請購買中會專用方案。");
  return result;
}
