import { and, desc, eq, gte, lt, sql } from "drizzle-orm";
import type { getDb } from "../../../../db";
import {
  activationCodeAuditLogs,
  activationCodeBatches,
  activationCodes,
  appSettings,
  medtechProducts,
} from "../../../../db/schema";
import {
  AI_ACCESS_SETTINGS_KEY,
  DEFAULT_AI_PLAN,
  type AiPlan,
} from "../../../../lib/ai-access";
import { MEDTECH_DEFAULT_PRODUCT_KEY } from "../../../../lib/medtech-product-settings";
import { requireAdmin } from "../../../../lib/member-auth";

type Db = Awaited<ReturnType<typeof getDb>>;
const categories = [
  "law",
  "pengli",
  "accounting",
  "medtech",
  "data-structure",
] as const;
function randomPart(length = 4) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789",
    bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}
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
function publicCode(code: typeof activationCodes.$inferSelect) {
  return {
    id: code.id,
    batchId: code.batchId,
    last4: code.last4,
    label: code.label,
    status: code.status,
    benefitType: code.benefitType,
    categories: code.examCategory ? [code.examCategory] : categories.slice(),
    productKey: code.productKey,
    quota: code.quota,
    durationDays: code.durationDays,
    redeemBy: code.redeemBy?.toISOString().slice(0, 10) ?? null,
    createdAt: code.createdAt.toISOString(),
    createdBy: code.createdBy,
    redeemedAt: code.redeemedAt?.toISOString() ?? null,
    redeemedBy: code.redeemedByMemberId
      ? `會員 #${code.redeemedByMemberId}`
      : null,
    selectedUnitLabel: code.selectedUnitLabel,
    disabledBy: code.disabledBy,
    disabledReason: code.disabledReason,
  };
}
async function readPolicy(db: Db) {
  const [row] = await db
    .select()
    .from(appSettings)
    .where(eq(appSettings.key, AI_ACCESS_SETTINGS_KEY))
    .limit(1);
  try {
    return {
      ...DEFAULT_AI_PLAN,
      ...((JSON.parse(row?.value ?? "") as { policy?: Partial<AiPlan> })
        .policy ?? {}),
      coachRounds: 1,
      autoRenew: false,
    } as AiPlan;
  } catch {
    return DEFAULT_AI_PLAN;
  }
}
async function savePolicy(db: Db, policy: AiPlan) {
  const [row] = await db
    .select()
    .from(appSettings)
    .where(eq(appSettings.key, AI_ACCESS_SETTINGS_KEY))
    .limit(1);
  let stored: Record<string, unknown> = {};
  try {
    stored = JSON.parse(row?.value ?? "{}");
  } catch {}
  const value = JSON.stringify({
    ...stored,
    policy,
    updatedAt: new Date().toISOString(),
  });
  await db
    .insert(appSettings)
    .values({ key: AI_ACCESS_SETTINGS_KEY, value, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: { value, updatedAt: new Date() },
    });
}
function creatorLimits(email: string) {
  return email === "iamflashon@gmail.com"
    ? { batch: 100, daily: 500, monthly: 5000, role: "總管理員" }
    : { batch: 30, daily: 50, monthly: 300, role: "授權管理員" };
}
function timeBounds() {
  const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Taipei",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
      .format(new Date())
      .split("-")
      .map(Number),
    [year, month, day] = parts;
  return {
    dayStart: new Date(
      `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T00:00:00+08:00`,
    ),
    monthStart: new Date(
      `${year}-${String(month).padStart(2, "0")}-01T00:00:00+08:00`,
    ),
    nextMonth: new Date(
      `${month === 12 ? year + 1 : year}-${String(month === 12 ? 1 : month + 1).padStart(2, "0")}-01T00:00:00+08:00`,
    ),
  };
}
async function creatorUsage(db: Db, memberId: number) {
  const { dayStart, monthStart, nextMonth } = timeBounds();
  const [[day], [month]] = await Promise.all([
    db
      .select({
        value: sql<number>`coalesce(sum(${activationCodeBatches.quantity}),0)`,
      })
      .from(activationCodeBatches)
      .where(
        and(
          eq(activationCodeBatches.createdByMemberId, memberId),
          gte(activationCodeBatches.createdAt, dayStart),
        ),
      ),
    db
      .select({
        value: sql<number>`coalesce(sum(${activationCodeBatches.quantity}),0)`,
      })
      .from(activationCodeBatches)
      .where(
        and(
          eq(activationCodeBatches.createdByMemberId, memberId),
          gte(activationCodeBatches.createdAt, monthStart),
          lt(activationCodeBatches.createdAt, nextMonth),
        ),
      ),
  ]);
  return { today: Number(day?.value ?? 0), month: Number(month?.value ?? 0) };
}
async function payload(db: Db, member: { id: number; email: string }) {
  const [codes, policy, batches, usage, products] = await Promise.all([
    db
      .select()
      .from(activationCodes)
      .orderBy(desc(activationCodes.createdAt))
      .limit(500),
    readPolicy(db),
    db
      .select()
      .from(activationCodeBatches)
      .orderBy(desc(activationCodeBatches.createdAt))
      .limit(100),
    creatorUsage(db, member.id),
    db
      .select({
        productKey: medtechProducts.productKey,
        title: medtechProducts.title,
        status: medtechProducts.status,
      })
      .from(medtechProducts),
  ]);
  const activeProducts = products.filter(
    (product) => product.status === "active",
  );
  return {
    policy,
    codes: codes.map(publicCode),
    batches: batches.map((row) => ({
      ...row,
      createdAt: row.createdAt.toISOString(),
    })),
    medtechProducts: activeProducts.length
      ? activeProducts
      : [
          {
            productKey: MEDTECH_DEFAULT_PRODUCT_KEY,
            title: "醫檢師國考題詳解（Ⅲ）臨床病毒學（下）",
            status: "active",
          },
        ],
    generator: { limits: creatorLimits(member.email), usage },
    updatedAt: new Date().toISOString(),
  };
}
async function audit(
  db: Db,
  input: {
    codeId?: string;
    batchId?: string;
    memberId: number;
    email: string;
    action: string;
    details?: Record<string, unknown>;
  },
) {
  await db
    .insert(activationCodeAuditLogs)
    .values({
      codeId: input.codeId ?? null,
      batchId: input.batchId ?? null,
      actorMemberId: input.memberId,
      actorEmail: input.email,
      action: input.action,
      detailsJson: JSON.stringify(input.details ?? {}),
    });
}

export async function GET(request: Request) {
  const auth = await requireAdmin(request);
  if ("error" in auth) return auth.error;
  return Response.json(await payload(auth.db, auth.member), {
    headers: { "cache-control": "no-store" },
  });
}
export async function POST(request: Request) {
  const auth = await requireAdmin(request);
  if ("error" in auth) return auth.error;
  const body = (await request.json()) as Record<string, unknown>;
  if (body.action === "save-policy") {
    const input = body.policy as Partial<AiPlan> | undefined,
      selected = Array.isArray(input?.categories)
        ? input.categories.filter((x) =>
            categories.includes(x as (typeof categories)[number]),
          )
        : [];
    const policy: AiPlan = {
      enabled: input?.enabled === true,
      lawScholarReflectionEnabled: input?.lawScholarReflectionEnabled !== false,
      pengliScholarReflectionEnabled:
        input?.pengliScholarReflectionEnabled !== false,
      scholarAssistEnabled: input?.pengliScholarReflectionEnabled !== false,
      name:
        String(input?.name ?? DEFAULT_AI_PLAN.name)
          .trim()
          .slice(0, 80) || DEFAULT_AI_PLAN.name,
      price: Math.max(1, Math.min(10000, Number(input?.price) || 30)),
      quota: Math.max(1, Math.min(1000, Number(input?.quota) || 30)),
      durationDays: Math.max(
        1,
        Math.min(365, Number(input?.durationDays) || 30),
      ),
      coachRounds: 1,
      promoEnabled: input?.promoEnabled === true,
      promoBonusQuota: Math.max(0, Math.min(1000, Number(input?.promoBonusQuota) || 0)),
      promoStartsAt: String(input?.promoStartsAt ?? "").slice(0, 40),
      promoEndsAt: String(input?.promoEndsAt ?? "").slice(0, 40),
      promoFirstPurchaseOnly: input?.promoFirstPurchaseOnly !== false,
      autoRenew: false,
      categories: selected.length ? selected : [...categories],
      notes: String(input?.notes ?? "")
        .trim()
        .slice(0, 2000),
    };
    await savePolicy(auth.db, policy);
    return Response.json(await payload(auth.db, auth.member));
  }
  if (body.action === "generate-codes") {
    const policy = await readPolicy(auth.db),
      count = Math.max(1, Math.min(100, Number(body.count) || 1)),
      label =
        String(body.label ?? "贈送方案")
          .trim()
          .slice(0, 80) || "贈送方案",
      purpose = String(body.purpose ?? body.label ?? "")
        .trim()
        .slice(0, 200),
      benefitType =
        body.benefitType === "medtech_pack_choice"
          ? "medtech_pack_choice"
          : body.benefitType === "medtech_book"
            ? "medtech_book"
            : "ai_access";
    if (purpose.length < 3)
      return Response.json(
        { error: "請填寫至少 3 個字的產製用途" },
        { status: 400 },
      );
    const limits = creatorLimits(auth.member.email),
      usage = await creatorUsage(auth.db, auth.member.id);
    if (count > limits.batch)
      return Response.json(
        { error: `您的單批上限為 ${limits.batch} 張` },
        { status: 409 },
      );
    if (usage.today + count > limits.daily)
      return Response.json(
        { error: `今日已產生 ${usage.today} 張，每日上限 ${limits.daily} 張` },
        { status: 409 },
      );
    if (usage.month + count > limits.monthly)
      return Response.json(
        {
          error: `本月已產生 ${usage.month} 張，每月上限 ${limits.monthly} 張`,
        },
        { status: 409 },
      );
    const examCategory = benefitType.startsWith("medtech") ? "medtech" : "";
    let productKey = benefitType === "medtech_pack_choice" ? "any-30" : "";
    if (benefitType === "medtech_book") {
      productKey = String(body.productKey ?? "").trim();
      const [product] = await auth.db
        .select({ productKey: medtechProducts.productKey })
        .from(medtechProducts)
        .where(
          and(
            eq(medtechProducts.productKey, productKey),
            eq(medtechProducts.status, "active"),
          ),
        )
        .limit(1);
      if (!product && productKey !== MEDTECH_DEFAULT_PRODUCT_KEY)
        return Response.json(
          { error: "請重新選擇目前開放的醫檢指定書籍" },
          { status: 400 },
        );
      if (!productKey) productKey = MEDTECH_DEFAULT_PRODUCT_KEY;
    }
    const durationDays =
        benefitType === "medtech_pack_choice"
          ? 0
          : Math.max(
              1,
              Math.min(365, Number(body.durationDays) || policy.durationDays),
            ),
      redeemBy = body.redeemBy
        ? new Date(`${String(body.redeemBy).slice(0, 10)}T23:59:59+08:00`)
        : null,
      batchId = crypto.randomUUID(),
      plaintext: string[] = [];
    await auth.db
      .insert(activationCodeBatches)
      .values({
        id: batchId,
        label,
        purpose,
        benefitType,
        quantity: count,
        createdByMemberId: auth.member.id,
        createdByEmail: auth.member.email,
        dailyLimit: limits.daily,
        monthlyLimit: limits.monthly,
      });
    for (let i = 0; i < count; i++) {
      const prefix =
          benefitType === "medtech_pack_choice"
            ? "M30"
            : benefitType === "medtech_book"
              ? "MT"
              : "AI",
        code = `IB-${prefix}-${randomPart()}-${randomPart()}`,
        id = crypto.randomUUID();
      plaintext.push(code);
      await auth.db
        .insert(activationCodes)
        .values({
          id,
          batchId,
          codeHash: await digest(code),
          last4: code.slice(-4),
          label,
          benefitType,
          examCategory,
          productKey,
          quota: benefitType === "ai_access" ? policy.quota : 0,
          durationDays,
          status: "unused",
          redeemBy,
          createdBy: auth.member.email,
          createdByMemberId: auth.member.id,
        });
      await audit(auth.db, {
        codeId: id,
        batchId,
        memberId: auth.member.id,
        email: auth.member.email,
        action: "generated",
        details: { label, purpose, benefitType, productKey },
      });
    }
    await audit(auth.db, {
      batchId,
      memberId: auth.member.id,
      email: auth.member.email,
      action: "batch_generated",
      details: { count, label, purpose, benefitType, productKey },
    });
    return Response.json({
      ...(await payload(auth.db, auth.member)),
      generatedCodes: plaintext,
    });
  }
  if (body.action === "disable-code") {
    const id = String(body.id ?? ""),
      reason = String(body.reason ?? "")
        .trim()
        .slice(0, 200);
    if (reason.length < 3)
      return Response.json({ error: "請填寫停用原因" }, { status: 400 });
    const [updated] = await auth.db
      .update(activationCodes)
      .set({
        status: "disabled",
        disabledBy: auth.member.email,
        disabledReason: reason,
        updatedAt: new Date(),
      })
      .where(
        and(eq(activationCodes.id, id), eq(activationCodes.status, "unused")),
      )
      .returning();
    if (!updated)
      return Response.json(
        { error: "找不到可停用的未兌換啟用碼" },
        { status: 404 },
      );
    await audit(auth.db, {
      codeId: id,
      batchId: updated.batchId ?? undefined,
      memberId: auth.member.id,
      email: auth.member.email,
      action: "disabled",
      details: { reason },
    });
    return Response.json(await payload(auth.db, auth.member));
  }
  return Response.json({ error: "不支援的操作" }, { status: 400 });
}
