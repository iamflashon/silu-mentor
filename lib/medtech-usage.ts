import { and, desc, eq, gte, inArray } from "drizzle-orm";
import type { getDb } from "../db";
import { medtechPointLedger, medtechUsage } from "../db/schema";

// 醫檢師平台統一使用點數：首次登入贈 10 點，提示與比較選項走快取，
// 語音完整解析與 AI 追問各自按次扣 1 點。保留舊欄位讀取僅為相容既有資料。
export const MEDTECH_AUDIO_TRIAL_LIMIT = 0;
export const MEDTECH_STARTING_POINTS = 10;
export const MEDTECH_QUESTION_ACCESS_HOURS = 7 * 24;
export const MEDTECH_AUDIO_ACCESS_HOURS = 24;
export const MEDTECH_QUESTION_PACKAGE_COST = 30;
export const MEDTECH_QUESTION_PACKAGE_HOURS = 7 * 24;
export const MEDTECH_CHAPTER_PACKAGE_COST = MEDTECH_QUESTION_PACKAGE_COST;
export const MEDTECH_CHAPTER_PACKAGE_HOURS = MEDTECH_QUESTION_PACKAGE_HOURS;
// 保留舊名稱，讓既有頁面與資料相容；平台語意統一稱為「點數」。
export const MEDTECH_STARTING_AI_CREDITS = MEDTECH_STARTING_POINTS;

export function medtechUserKey(request: Request) {
  return request.headers.get("oai-authenticated-user-email")?.trim().toLowerCase() || "default-owner";
}

export async function getOrCreateMedtechUsage(db: Awaited<ReturnType<typeof getDb>>, userKey: string) {
  const [existing] = await db.select().from(medtechUsage).where(eq(medtechUsage.userKey, userKey)).limit(1);
  if (existing) {
    return existing;
  }
  const [created] = await db.insert(medtechUsage).values({ userKey, aiCredits: MEDTECH_STARTING_POINTS }).returning();
  await db.insert(medtechPointLedger).values({
    userKey,
    delta: MEDTECH_STARTING_POINTS,
    balanceAfter: MEDTECH_STARTING_POINTS,
    action: "welcome_gift",
    description: "首次登入贈送 10 點",
  });
  return created;
}

export async function spendMedtechPoints(
  db: Awaited<ReturnType<typeof getDb>>,
  usage: { id: number; userKey: string; aiCredits: number },
  details: { action: string; description: string; questionId?: number; sourceDetail?: string; retainHours?: number; amount?: number },
) {
  const amount = Math.max(1, Math.floor(details.amount ?? 1));
  if (usage.aiCredits < amount) return null;
  const nextCredits = usage.aiCredits - amount;
  const [updated] = await db.update(medtechUsage)
    .set({ aiCredits: nextCredits, updatedAt: new Date() })
    .where(and(eq(medtechUsage.id, usage.id), gte(medtechUsage.aiCredits, amount)))
    .returning();
  if (!updated) return null;
  await db.insert(medtechPointLedger).values({
    userKey: usage.userKey,
    delta: -amount,
    balanceAfter: updated.aiCredits,
    action: details.action,
    description: details.description,
    questionId: details.questionId,
    sourceDetail: details.sourceDetail,
    availableUntil: details.retainHours ? new Date(Date.now() + details.retainHours * 60 * 60 * 1000) : undefined,
  });
  return updated;
}

export async function consumeMedtechFeature(
  db: Awaited<ReturnType<typeof getDb>>,
  usage: { id: number; userKey: string; aiCredits: number },
  details: { action: string; description: string; questionId?: number; sourceDetail?: string; retainHours?: number; reuseWithinHours?: number },
) {
  let previouslyUsed = false;
  if (details.questionId && details.reuseWithinHours) {
    const [prior] = await db.select({ id: medtechPointLedger.id })
      .from(medtechPointLedger)
      .where(and(
        eq(medtechPointLedger.userKey, usage.userKey),
        eq(medtechPointLedger.action, details.action),
        eq(medtechPointLedger.questionId, details.questionId),
      ))
      .limit(1);
    previouslyUsed = Boolean(prior);
    const cutoff = new Date(Date.now() - details.reuseWithinHours * 60 * 60 * 1000);
    const [recent] = await db.select({ id: medtechPointLedger.id })
      .from(medtechPointLedger)
      .where(and(
        eq(medtechPointLedger.userKey, usage.userKey),
        eq(medtechPointLedger.action, details.action),
        eq(medtechPointLedger.questionId, details.questionId),
        gte(medtechPointLedger.createdAt, cutoff),
      ))
      .orderBy(desc(medtechPointLedger.createdAt))
      .limit(1);
    if (recent) return { usage, charged: false };
  }
  const updated = await spendMedtechPoints(db, usage, {
    ...details,
    retainHours: details.retainHours ?? details.reuseWithinHours,
    sourceDetail: details.sourceDetail ?? (previouslyUsed
      ? `${(details.retainHours ?? details.reuseWithinHours ?? 24) >= 168 ? "7 天" : "24 小時"}使用權已到期，重新解鎖`
      : `首次使用，建立 ${(details.retainHours ?? details.reuseWithinHours ?? 24) >= 168 ? "7 天" : "24 小時"}使用權`),
  });
  return updated ? { usage: updated, charged: true } : null;
}

export async function addMedtechPoints(
  db: Awaited<ReturnType<typeof getDb>>,
  userKey: string,
  amount: number,
  description: string,
) {
  const usage = await getOrCreateMedtechUsage(db, userKey);
  const safeAmount = Math.max(1, Math.floor(amount));
  const nextCredits = usage.aiCredits + safeAmount;
  const [updated] = await db.update(medtechUsage).set({ aiCredits: nextCredits, updatedAt: new Date() }).where(eq(medtechUsage.id, usage.id)).returning();
  if (!updated) return null;
  await db.insert(medtechPointLedger).values({ userKey, delta: safeAmount, balanceAfter: nextCredits, action: "admin_grant", description });
  return updated;
}

export async function grantMedtechQuestionAccess(
  db: Awaited<ReturnType<typeof getDb>>,
  userKey: string,
  questionIds: number[],
) {
  const uniqueIds = [...new Set(questionIds.filter((id) => Number.isInteger(id) && id > 0))];
  const usage = await getOrCreateMedtechUsage(db, userKey);
  if (!uniqueIds.length) return { usage, allowedIds: [], limited: false };
  const cutoff = new Date(Date.now() - MEDTECH_QUESTION_ACCESS_HOURS * 60 * 60 * 1000);
  const previous = await db.select({ questionId: medtechPointLedger.questionId })
    .from(medtechPointLedger)
    .where(and(
      eq(medtechPointLedger.userKey, userKey),
      eq(medtechPointLedger.action, "question_view"),
      inArray(medtechPointLedger.questionId, uniqueIds),
    ))
    .orderBy(desc(medtechPointLedger.createdAt));
  const recent = await db.select({ questionId: medtechPointLedger.questionId })
    .from(medtechPointLedger)
    .where(and(
      eq(medtechPointLedger.userKey, userKey),
      eq(medtechPointLedger.action, "question_view"),
      gte(medtechPointLedger.createdAt, cutoff),
      inArray(medtechPointLedger.questionId, uniqueIds),
    ))
    .orderBy(desc(medtechPointLedger.createdAt));
  const freeIds = new Set(recent.map((row) => row.questionId).filter((id): id is number => id !== null));
  const previousIds = new Set(previous.map((row) => row.questionId).filter((id): id is number => id !== null));
  const newIds = uniqueIds.filter((id) => !freeIds.has(id));
  const chargeableIds = newIds.slice(0, Math.max(0, usage.aiCredits));
  let current = usage;
  const chargedIds: number[] = [];
  for (const questionId of chargeableIds) {
    const updated = await spendMedtechPoints(db, current, {
      action: "question_view",
      description: "查看題目（7 天內可無限重做）",
      questionId,
      retainHours: MEDTECH_QUESTION_ACCESS_HOURS,
      sourceDetail: previousIds.has(questionId) ? "7 天刷題權已到期，重新解鎖" : "首次查看，建立 7 天刷題權",
    });
    if (!updated) break;
    current = updated;
    chargedIds.push(questionId);
  }
  const allowedIds = new Set([...freeIds, ...chargedIds]);
  return { usage: current, allowedIds: uniqueIds.filter((id) => allowedIds.has(id)), limited: allowedIds.size < uniqueIds.length };
}

export async function grantMedtechQuestionPackageAccess(
  db: Awaited<ReturnType<typeof getDb>>,
  userKey: string,
  packageName: string,
  questionIds: number[],
) {
  const candidateIds = [...new Set(questionIds.filter((id) => Number.isInteger(id) && id > 0))].slice(0, 30);
  const usage = await getOrCreateMedtechUsage(db, userKey);
  const description = `${packageName}題目包（7 天內可隨意刷）`;
  const cutoff = new Date(Date.now() - MEDTECH_QUESTION_PACKAGE_HOURS * 60 * 60 * 1000);
  const [activePackage] = await db.select({
    action: medtechPointLedger.action,
    availableUntil: medtechPointLedger.availableUntil,
    sourceDetail: medtechPointLedger.sourceDetail,
    createdAt: medtechPointLedger.createdAt,
  })
    .from(medtechPointLedger)
    .where(and(
      eq(medtechPointLedger.userKey, userKey),
      inArray(medtechPointLedger.action, ["question_pack", "question_pack_gift"]),
      eq(medtechPointLedger.description, description),
      gte(medtechPointLedger.createdAt, cutoff),
    ))
    .orderBy(desc(medtechPointLedger.createdAt))
    .limit(1);

  const packageIdsFromDetail = (sourceDetail: string | null) => {
    const match = sourceDetail?.match(/固定題目：([\d, ]+)$/u);
    if (!match) return [];
    return [...new Set(match[1].split(",").map((value) => Number(value.trim())).filter((id) => Number.isInteger(id) && id > 0))].slice(0, 30);
  };
  const activeIds = packageIdsFromDetail(activePackage?.sourceDetail ?? null);
  const availableUntil = activePackage?.availableUntil ?? (activePackage ? new Date(activePackage.createdAt.getTime() + MEDTECH_QUESTION_PACKAGE_HOURS * 60 * 60 * 1000) : null);
  if (activePackage) {
    return {
      usage,
      allowedIds: activeIds.length ? activeIds : candidateIds,
      packageQuestionIds: activeIds.length ? activeIds : candidateIds,
      limited: false,
      hasAccess: true,
      charged: false,
      gifted: activePackage.action === "question_pack_gift",
      packageCost: MEDTECH_QUESTION_PACKAGE_COST,
      availableUntil,
    };
  }
  if (!candidateIds.length) {
    return { usage, allowedIds: [], packageQuestionIds: [], limited: false, hasAccess: false, charged: false, gifted: false, packageCost: MEDTECH_QUESTION_PACKAGE_COST, availableUntil: null };
  }

  // 每個章節／模考包第一次進入提供一次免費初體驗；同一包到期後才需要購買。
  const [previousGift] = await db.select({ id: medtechPointLedger.id })
    .from(medtechPointLedger)
    .where(and(
      eq(medtechPointLedger.userKey, userKey),
      eq(medtechPointLedger.action, "question_pack_gift"),
      eq(medtechPointLedger.description, description),
    ))
    .limit(1);
  const packageSource = (gift: boolean) => `題目包：${packageName}；${gift ? "首次體驗贈送，不扣點" : `一次購足 ${MEDTECH_QUESTION_PACKAGE_COST} 點`}；7 天內隨意刷；固定題目：${candidateIds.join(",")}`;
  if (!previousGift) {
    const giftUntil = new Date(Date.now() + MEDTECH_QUESTION_PACKAGE_HOURS * 60 * 60 * 1000);
    await db.insert(medtechPointLedger).values({
      userKey,
      delta: 0,
      balanceAfter: usage.aiCredits,
      action: "question_pack_gift",
      description,
      sourceDetail: packageSource(true),
      availableUntil: giftUntil,
    });
    return { usage, allowedIds: candidateIds, packageQuestionIds: candidateIds, limited: false, hasAccess: true, charged: false, gifted: true, packageCost: MEDTECH_QUESTION_PACKAGE_COST, availableUntil: giftUntil };
  }
  if (usage.aiCredits < MEDTECH_QUESTION_PACKAGE_COST) {
    return { usage, allowedIds: candidateIds, packageQuestionIds: candidateIds, limited: true, hasAccess: false, charged: false, gifted: false, packageCost: MEDTECH_QUESTION_PACKAGE_COST, availableUntil: null };
  }
  const updated = await spendMedtechPoints(db, usage, {
    action: "question_pack",
    description,
    sourceDetail: packageSource(false),
    retainHours: MEDTECH_QUESTION_PACKAGE_HOURS,
    amount: MEDTECH_QUESTION_PACKAGE_COST,
  });
  if (!updated) return { usage, allowedIds: candidateIds, packageQuestionIds: candidateIds, limited: true, hasAccess: false, charged: false, gifted: false, packageCost: MEDTECH_QUESTION_PACKAGE_COST, availableUntil: null };
  const paidUntil = new Date(Date.now() + MEDTECH_QUESTION_PACKAGE_HOURS * 60 * 60 * 1000);
  return { usage: updated, allowedIds: candidateIds, packageQuestionIds: candidateIds, limited: false, hasAccess: true, charged: true, gifted: false, packageCost: MEDTECH_QUESTION_PACKAGE_COST, availableUntil: paidUntil };
}

export function audioTrialIds(row: { audioTrialQuestionIdsJson: string }) {
  try {
    const ids = JSON.parse(row.audioTrialQuestionIdsJson || "[]") as unknown;
    return Array.isArray(ids) ? ids.filter((id): id is number => Number.isInteger(id) && id > 0) : [];
  } catch {
    return [];
  }
}
