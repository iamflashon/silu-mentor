import { and, desc, eq, gt, inArray } from "drizzle-orm";
import {
  activationCodeAuditLogs,
  activationCodes,
  aiPaymentOrders,
  medtechMemberEntitlements,
  medtechPointLedger,
  memberExamAccess,
} from "../../../db/schema";
import {
  aiPurchaseOffer,
  getActiveAiEntitlement,
  getAiPlan,
  grantAiAccess,
  publicAiAccess,
} from "../../../lib/ai-access";
import { MEDTECH_DEFAULT_PRODUCT_KEY } from "../../../lib/medtech-product-settings";
import { listMedtechQuestionUnits } from "../../../lib/medtech-question-units";
import { medtechPackDescription } from "../../../lib/medtech-usage";
import { requireMember } from "../../../lib/member-auth";

async function digest(value: string) {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(value.trim().toUpperCase()),
      ),
    ),
  )
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
type Auth = Exclude<
  Awaited<ReturnType<typeof requireMember>>,
  { error: Response }
>;
async function ownedPackDescriptions(auth: Auth) {
  const now = Date.now(),
    fallback = now - 7 * 86400000;
  const rows = await auth.db
    .select({
      description: medtechPointLedger.description,
      action: medtechPointLedger.action,
      availableUntil: medtechPointLedger.availableUntil,
      createdAt: medtechPointLedger.createdAt,
    })
    .from(medtechPointLedger)
    .where(
      and(
        eq(medtechPointLedger.userKey, auth.userKey),
        inArray(medtechPointLedger.action, [
          "question_pack",
          "question_pack_gift",
          "question_pack_voucher",
        ]),
      ),
    );
  return new Set(
    rows
      .filter(
        (row) =>
          row.action === "question_pack_voucher" ||
          (row.availableUntil
            ? row.availableUntil.getTime() > now
            : row.createdAt.getTime() > fallback),
      )
      .map((row) => row.description),
  );
}
async function selectableUnits(auth: Auth) {
  const [units, owned] = await Promise.all([
    listMedtechQuestionUnits(auth.db),
    ownedPackDescriptions(auth),
  ]);
  return units
    .filter(
      (unit) =>
        !owned.has(medtechPackDescription(unit.packageName, unit.packNumber)),
    )
    .map(({ questionIds, ...unit }) => unit);
}
async function state(auth: Auth) {
  const now = new Date();
  const [basePlan, ai, [medtech], voucherRows, [previousPurchase]] = await Promise.all([
    getAiPlan(auth.db),
    getActiveAiEntitlement(auth.db, auth.member.id),
    auth.db
      .select()
      .from(medtechMemberEntitlements)
      .where(
        and(
          eq(medtechMemberEntitlements.memberId, auth.member.id),
          eq(medtechMemberEntitlements.status, "active"),
          gt(medtechMemberEntitlements.expiresAt, now),
        ),
      )
      .orderBy(desc(medtechMemberEntitlements.expiresAt))
      .limit(1),
    auth.db
      .select({
        description: medtechPointLedger.description,
        sourceDetail: medtechPointLedger.sourceDetail,
        createdAt: medtechPointLedger.createdAt,
      })
      .from(medtechPointLedger)
      .where(
        and(
          eq(medtechPointLedger.userKey, auth.userKey),
          eq(medtechPointLedger.action, "question_pack_voucher"),
        ),
      )
      .orderBy(desc(medtechPointLedger.createdAt)),
    auth.db
      .select({ id: aiPaymentOrders.id })
      .from(aiPaymentOrders)
      .where(and(eq(aiPaymentOrders.memberId, auth.member.id), eq(aiPaymentOrders.status, "paid")))
      .limit(1),
  ]);
  const plan = aiPurchaseOffer(basePlan, Boolean(previousPurchase));
  return {
    plan,
    aiAccess: { ...publicAiAccess(ai), coachRoundsTarget: plan.coachRounds },
    medtechAccess: medtech
      ? {
          active: true,
          productKey: medtech.productKey,
          startsAt: medtech.startsAt.toISOString(),
          expiresAt: medtech.expiresAt.toISOString(),
          source: medtech.source,
        }
      : { active: false },
    medtechPackAccess: voucherRows.map((row) => ({
      label:
        row.sourceDetail?.match(/兌換單元：([^；]+)/u)?.[1] ?? row.description,
      createdAt: row.createdAt.toISOString(),
    })),
  };
}
async function audit(
  auth: Auth,
  code: typeof activationCodes.$inferSelect,
  action: string,
  details: Record<string, unknown> = {},
) {
  await auth.db
    .insert(activationCodeAuditLogs)
    .values({
      codeId: code.id,
      batchId: code.batchId,
      actorMemberId: auth.member.id,
      actorEmail: auth.member.email,
      action,
      detailsJson: JSON.stringify(details),
    });
}

export async function GET(request: Request) {
  const auth = await requireMember(request);
  if ("error" in auth) return auth.error;
  return Response.json(await state(auth), {
    headers: { "cache-control": "no-store" },
  });
}
export async function POST(request: Request) {
  const auth = await requireMember(request);
  if ("error" in auth) return auth.error;
  const body = (await request.json()) as { code?: string; unitKey?: string },
    raw = String(body.code ?? "")
      .trim()
      .toUpperCase();
  if (!/^IB-(AI|MT|M30)-[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(raw))
    return Response.json({ error: "啟用碼格式不正確" }, { status: 400 });
  const codeHash = await digest(raw),
    [code] = await auth.db
      .select()
      .from(activationCodes)
      .where(eq(activationCodes.codeHash, codeHash))
      .limit(1);
  if (!code) return Response.json({ error: "找不到此啟用碼" }, { status: 404 });
  if (code.status !== "unused")
    return Response.json(
      {
        error:
          code.status === "redeemed"
            ? "此啟用碼已兌換"
            : "此啟用碼已停用或過期",
      },
      { status: 409 },
    );
  if (code.redeemBy && code.redeemBy < new Date()) {
    await auth.db
      .update(activationCodes)
      .set({ status: "expired", updatedAt: new Date() })
      .where(
        and(
          eq(activationCodes.id, code.id),
          eq(activationCodes.status, "unused"),
        ),
      );
    await audit(auth, code, "expired");
    return Response.json({ error: "此啟用碼已超過兌換期限" }, { status: 410 });
  }
  if (code.benefitType === "medtech_pack_choice" && !body.unitKey) {
    const units = await selectableUnits(auth);
    if (!units.length)
      return Response.json(
        { error: "目前沒有可兌換的新單元" },
        { status: 409 },
      );
    await audit(auth, code, "selection_viewed", { unitCount: units.length });
    return Response.json({
      selectionRequired: true,
      benefitType: code.benefitType,
      codeLast4: code.last4,
      units,
    });
  }
  if (
    code.benefitType === "ai_access" &&
    (await getActiveAiEntitlement(auth.db, auth.member.id))
  )
    return Response.json(
      { error: "目前已有使用中的 AI 方案，請於額度用完或到期後再兌換" },
      { status: 409 },
    );
  if (code.benefitType === "medtech_book") {
    const [active] = await auth.db
      .select()
      .from(medtechMemberEntitlements)
      .where(
        and(
          eq(medtechMemberEntitlements.memberId, auth.member.id),
          eq(
            medtechMemberEntitlements.productKey,
            code.productKey || MEDTECH_DEFAULT_PRODUCT_KEY,
          ),
          eq(medtechMemberEntitlements.status, "active"),
          gt(medtechMemberEntitlements.expiresAt, new Date()),
        ),
      )
      .limit(1);
    if (active)
      return Response.json(
        { error: "目前已有使用中的醫檢書籍方案，請於到期後再兌換" },
        { status: 409 },
      );
  }
  let chosen:
    Awaited<ReturnType<typeof listMedtechQuestionUnits>>[number] | null = null;
  if (code.benefitType === "medtech_pack_choice") {
    const units = await listMedtechQuestionUnits(auth.db);
    chosen = units.find((unit) => unit.key === body.unitKey) ?? null;
    if (!chosen)
      return Response.json(
        { error: "找不到這組 30 題單元，請重新選擇" },
        { status: 404 },
      );
    const owned = await ownedPackDescriptions(auth);
    if (
      owned.has(medtechPackDescription(chosen.packageName, chosen.packNumber))
    )
      return Response.json(
        { error: "您已開通這組題目，請改選其他單元；兌換券尚未使用" },
        { status: 409 },
      );
  }
  const [claimed] = await auth.db
    .update(activationCodes)
    .set({
      status: "redeemed",
      redeemedAt: new Date(),
      redeemedByMemberId: auth.member.id,
      selectedUnitKey: chosen?.key ?? "",
      selectedUnitLabel: chosen?.label ?? "",
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(activationCodes.id, code.id),
        eq(activationCodes.status, "unused"),
      ),
    )
    .returning();
  if (!claimed)
    return Response.json(
      { error: "此啟用碼剛剛已被其他帳號兌換" },
      { status: 409 },
    );
  try {
    if (code.benefitType === "ai_access")
      await grantAiAccess(auth.db, {
        memberId: auth.member.id,
        quota: code.quota || 30,
        durationDays: code.durationDays,
        source: "activation_code",
        referenceId: code.id,
        note: `啟用碼 ••••-${code.last4}`,
      });
    else if (code.benefitType === "medtech_book") {
      const now = new Date(),
        expiresAt = new Date(now.getTime() + code.durationDays * 86400000),
        productKey = code.productKey || MEDTECH_DEFAULT_PRODUCT_KEY;
      await auth.db
        .insert(memberExamAccess)
        .values({
          memberId: auth.member.id,
          examCategory: "medtech",
          status: "active",
          className: auth.member.className || "未分班",
        })
        .onConflictDoUpdate({
          target: [memberExamAccess.memberId, memberExamAccess.examCategory],
          set: { status: "active", updatedAt: now },
        });
      await auth.db
        .insert(medtechMemberEntitlements)
        .values({
          memberId: auth.member.id,
          productKey,
          status: "active",
          source: "activation_code",
          startsAt: now,
          expiresAt,
          note: `免費啟用碼 ••••-${code.last4}`,
          updatedBy: "activation_code",
        })
        .onConflictDoUpdate({
          target: [
            medtechMemberEntitlements.memberId,
            medtechMemberEntitlements.productKey,
          ],
          set: {
            status: "active",
            source: "activation_code",
            startsAt: now,
            expiresAt,
            note: `免費啟用碼 ••••-${code.last4}`,
            updatedBy: "activation_code",
            updatedAt: now,
          },
        });
    } else if (code.benefitType === "medtech_pack_choice" && chosen) {
      await auth.db
        .insert(memberExamAccess)
        .values({
          memberId: auth.member.id,
          examCategory: "medtech",
          status: "active",
          className: auth.member.className || "未分班",
        })
        .onConflictDoUpdate({
          target: [memberExamAccess.memberId, memberExamAccess.examCategory],
          set: { status: "active", updatedAt: new Date() },
        });
      await auth.db
        .insert(medtechPointLedger)
        .values({
          userKey: auth.userKey,
          delta: 0,
          balanceAfter: 0,
          action: "question_pack_voucher",
          description: medtechPackDescription(
            chosen.packageName,
            chosen.packNumber,
          ),
          sourceDetail: `30 題兌換券 ••••-${code.last4}；兌換單元：${chosen.label}；永久開通；固定題目：${chosen.questionIds.join(",")}`,
          availableUntil: new Date("2099-12-31T23:59:59+08:00"),
        });
    } else throw new Error("UNSUPPORTED_BENEFIT");
    await audit(auth, claimed, "redeemed", {
      benefitType: code.benefitType,
      unitKey: chosen?.key,
      unitLabel: chosen?.label,
    });
  } catch (error) {
    await auth.db
      .update(activationCodes)
      .set({
        status: "unused",
        redeemedAt: null,
        redeemedByMemberId: null,
        selectedUnitKey: "",
        selectedUnitLabel: "",
        updatedAt: new Date(),
      })
      .where(eq(activationCodes.id, code.id));
    await audit(auth, code, "redemption_rolled_back", {
      message: error instanceof Error ? error.message : "unknown",
    });
    throw error;
  }
  return Response.json({
    ok: true,
    benefitType: code.benefitType,
    selectedUnitLabel: chosen?.label,
    ...(await state(auth)),
  });
}
