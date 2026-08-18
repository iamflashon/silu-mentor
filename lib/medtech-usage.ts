import { and, desc, eq, gte, inArray, isNotNull, isNull, like, ne, or } from "drizzle-orm";
import type { getDb } from "../db";
import { medtechPointLedger, medtechPracticeSessions, medtechUsage } from "../db/schema";
import { taipeiDate } from "./taipei-time";

// 醫檢師平台統一使用點數：首次登入贈 10 點，提示與比較選項走快取，
// 語音完整解析與 AI 追問各自按次扣 1 點。保留舊欄位讀取僅為相容既有資料。
export const MEDTECH_AUDIO_TRIAL_LIMIT = 0;
export const MEDTECH_STARTING_POINTS = 10;
export const MEDTECH_QUESTION_ACCESS_HOURS = 7 * 24;
export const MEDTECH_AUDIO_ACCESS_HOURS = 24;
export const MEDTECH_QUESTION_PACKAGE_COST = 30;
export const MEDTECH_QUESTION_PACKAGE_SIZE = 30;
export const MEDTECH_PACK_QUIZ_ATTEMPT_LIMIT = 2;
export const MEDTECH_ULTIMATE_CHALLENGE_QUESTION_COUNT = 30;
export const MEDTECH_ULTIMATE_CHALLENGE_TIME_LIMIT_SECONDS = 3 * 60;
export const MEDTECH_ULTIMATE_CHALLENGE_COST = 3;
export const MEDTECH_QUESTION_PACKAGE_HOURS = 7 * 24;
export const MEDTECH_CHAPTER_PACKAGE_COST = MEDTECH_QUESTION_PACKAGE_COST;
export const MEDTECH_CHAPTER_PACKAGE_HOURS = MEDTECH_QUESTION_PACKAGE_HOURS;
const MEDTECH_OWNER_USER_KEY = "iamflashon@gmail.com";
const MEDTECH_SCREENSHOT_SERVICE_USER_KEY = "sites-screenshot-service-noreply@chatgpt.com";
// 保留舊名稱，讓既有頁面與資料相容；平台語意統一稱為「點數」。
export const MEDTECH_STARTING_AI_CREDITS = MEDTECH_STARTING_POINTS;

export const MEDTECH_ULTIMATE_DISCOUNT = { percent: 10, label: "一折", cost: MEDTECH_ULTIMATE_CHALLENGE_COST } as const;

export const MEDTECH_PACK_DISCOUNT_OPTIONS = [
  { percent: 50, label: "五折", cost: 15 },
  { percent: 75, label: "七五折", cost: 23 },
  { percent: 90, label: "九折", cost: 27 },
  { percent: 100, label: "原價", cost: MEDTECH_QUESTION_PACKAGE_COST },
] as const;

export type MedtechPackDiscountReward = {
  status: "available" | "revealed" | "abandoned" | "used";
  label: string | null;
  percent: number | null;
  cost: number;
  baseCost: number;
  retryAt?: string | null;
  quizAttemptsUsed?: number;
  quizAttemptsRemaining?: number;
};

export function medtechPackDescription(packageName: string, packageNumber: number) {
  return `${packageName}第 ${packageNumber} 包（7 天內可隨意刷）`;
}

function medtechPackDiscountDescription(packageName: string, packageNumber: number) {
  return `題目包轉轉樂：${packageName}第 ${packageNumber} 包`;
}

function parseMedtechPackDiscount(sourceDetail: string | null) {
  const match = sourceDetail?.match(/折扣：(\d+)折；優惠價 (\d+) 點/u);
  if (!match) return null;
  const percent = Number(match[1]);
  const cost = Number(match[2]);
  const option = percent === MEDTECH_ULTIMATE_DISCOUNT.percent && cost === MEDTECH_ULTIMATE_DISCOUNT.cost
    ? MEDTECH_ULTIMATE_DISCOUNT
    : MEDTECH_PACK_DISCOUNT_OPTIONS.find((item) => item.percent === percent && item.cost === cost);
  return option ? { percent: option.percent, label: option.label, cost: option.cost } : null;
}

export async function getMedtechPackDiscountReward(
  db: Awaited<ReturnType<typeof getDb>>,
  userKey: string,
  packageName: string,
  packageNumber: number,
): Promise<MedtechPackDiscountReward> {
  const rewardDescription = medtechPackDiscountDescription(packageName, packageNumber);
  const packageDescription = medtechPackDescription(packageName, packageNumber);
  const rewardRows = await db.select({ action: medtechPointLedger.action, sourceDetail: medtechPointLedger.sourceDetail, createdAt: medtechPointLedger.createdAt })
    .from(medtechPointLedger)
    .where(and(
      eq(medtechPointLedger.userKey, userKey),
      inArray(medtechPointLedger.action, ["question_pack_spin", "question_pack_spin_abandoned", "question_pack_quiz", "question_pack_ultimate"]),
      eq(medtechPointLedger.description, rewardDescription),
    ))
    .orderBy(desc(medtechPointLedger.createdAt))
    .limit(20);
  const quizAttemptsUsed = rewardRows.filter((row) => row.action === "question_pack_quiz").length;
  const quizAttemptsRemaining = Math.max(0, MEDTECH_PACK_QUIZ_ATTEMPT_LIMIT - quizAttemptsUsed);
  const attemptMeta = { quizAttemptsUsed, quizAttemptsRemaining };
  // 一折終極挑戰只保留到台北時間當日 00:00；過期後重新回到可挑戰狀態，
  // 不會把昨天的一折結果和今天的轉轉樂折扣疊在一起。
  const todayStart = new Date(`${taipeiDate()}T00:00:00+08:00`);
  const validRewardRows = rewardRows.filter((row) => row.action !== "question_pack_ultimate" || row.createdAt >= todayStart);
  const reward = validRewardRows[0];
  if (!reward) return { status: "available", label: null, percent: null, cost: MEDTECH_QUESTION_PACKAGE_COST, baseCost: MEDTECH_QUESTION_PACKAGE_COST, retryAt: null, ...attemptMeta };
  if (reward.action === "question_pack_spin_abandoned") {
    return { status: "abandoned", label: "原價", percent: 100, cost: MEDTECH_QUESTION_PACKAGE_COST, baseCost: MEDTECH_QUESTION_PACKAGE_COST, ...attemptMeta };
  }
  const parsedRewards = validRewardRows
    .filter((row) => row.action === "question_pack_spin" || row.action === "question_pack_quiz" || row.action === "question_pack_ultimate")
    .map((row) => ({ row, parsed: parseMedtechPackDiscount(row.sourceDetail) }))
    .filter((item): item is { row: (typeof rewardRows)[number]; parsed: NonNullable<ReturnType<typeof parseMedtechPackDiscount>> } => Boolean(item.parsed))
    .sort((left, right) => left.parsed.cost - right.parsed.cost);
  const best = parsedRewards[0];
  if (!best) return { status: "used", label: null, percent: null, cost: MEDTECH_QUESTION_PACKAGE_COST, baseCost: MEDTECH_QUESTION_PACKAGE_COST, ...attemptMeta };
  const [purchase] = await db.select({ id: medtechPointLedger.id })
    .from(medtechPointLedger)
    .where(and(
      eq(medtechPointLedger.userKey, userKey),
      eq(medtechPointLedger.action, "question_pack"),
      eq(medtechPointLedger.description, packageDescription),
      gte(medtechPointLedger.createdAt, reward.createdAt),
    ))
    .limit(1);
  if (purchase) {
    return { status: "used", label: best.parsed.label, percent: best.parsed.percent, cost: best.parsed.cost, baseCost: MEDTECH_QUESTION_PACKAGE_COST, retryAt: null, ...attemptMeta };
  }
  const retryAt = best.parsed.percent === 100 && best.row.action === "question_pack_spin"
    ? new Date(best.row.createdAt.getTime() + MEDTECH_AUDIO_ACCESS_HOURS * 60 * 60 * 1000)
    : null;
  if (retryAt && retryAt.getTime() <= Date.now()) {
    return { status: "available", label: null, percent: null, cost: MEDTECH_QUESTION_PACKAGE_COST, baseCost: MEDTECH_QUESTION_PACKAGE_COST, retryAt: null, ...attemptMeta };
  }
  return { status: "revealed", label: best.parsed.label, percent: best.parsed.percent, cost: best.parsed.cost, baseCost: MEDTECH_QUESTION_PACKAGE_COST, retryAt: retryAt?.toISOString() ?? null, ...attemptMeta };
}

export async function createMedtechUltimateChallengeReward(
  db: Awaited<ReturnType<typeof getDb>>,
  userKey: string,
  packageName: string,
  packageNumber: number,
  score: number,
  total: number,
  durationSeconds: number,
) {
  const current = await getMedtechPackDiscountReward(db, userKey, packageName, packageNumber);
  if (current.status !== "available") return current;
  const usage = await getOrCreateMedtechUsage(db, userKey);
  const normalizedScore = Math.max(0, Math.min(total, Math.floor(score)));
  const normalizedTotal = Math.max(1, Math.floor(total));
  const normalizedDuration = Math.max(0, Math.min(MEDTECH_ULTIMATE_CHALLENGE_TIME_LIMIT_SECONDS, Math.floor(durationSeconds)));
  await db.insert(medtechPointLedger).values({
    userKey,
    delta: 0,
    balanceAfter: usage.aiCredits,
    action: "question_pack_ultimate",
    description: medtechPackDiscountDescription(packageName, packageNumber),
    sourceDetail: `1 折終極挑戰：${normalizedTotal} 題答對 ${normalizedScore} 題；作答時間 ${normalizedDuration} 秒；折扣：10折；優惠價 ${MEDTECH_ULTIMATE_CHALLENGE_COST} 點；每日限一次。`,
  });
  return await getMedtechPackDiscountReward(db, userKey, packageName, packageNumber);
}

export async function createMedtechPackDiscountReward(
  db: Awaited<ReturnType<typeof getDb>>,
  userKey: string,
  packageName: string,
  packageNumber: number,
  action: "spin" | "abandon",
) {
  const current = await getMedtechPackDiscountReward(db, userKey, packageName, packageNumber);
  if (current.status !== "available") return current;
  const usage = await getOrCreateMedtechUsage(db, userKey);
  if (action === "abandon") {
    await db.insert(medtechPointLedger).values({
      userKey,
      delta: 0,
      balanceAfter: usage.aiCredits,
      action: "question_pack_spin_abandoned",
      description: medtechPackDiscountDescription(packageName, packageNumber),
      sourceDetail: `狀態：放棄折扣，之後以原價 ${MEDTECH_QUESTION_PACKAGE_COST} 點購買；一次機會已用完。`,
    });
    return { status: "abandoned", label: "原價", percent: 100, cost: MEDTECH_QUESTION_PACKAGE_COST, baseCost: MEDTECH_QUESTION_PACKAGE_COST, quizAttemptsUsed: current.quizAttemptsUsed ?? 0, quizAttemptsRemaining: current.quizAttemptsRemaining ?? MEDTECH_PACK_QUIZ_ATTEMPT_LIMIT } satisfies MedtechPackDiscountReward;
  }
  const random = new Uint32Array(1);
  crypto.getRandomValues(random);
  const option = MEDTECH_PACK_DISCOUNT_OPTIONS[random[0] % MEDTECH_PACK_DISCOUNT_OPTIONS.length];
  await db.insert(medtechPointLedger).values({
    userKey,
    delta: 0,
    balanceAfter: usage.aiCredits,
    action: "question_pack_spin",
    description: medtechPackDiscountDescription(packageName, packageNumber),
    sourceDetail: `結果：${option.label}；折扣：${option.percent}折；優惠價 ${option.cost} 點；每個題目包僅一次機會。`,
  });
  return { status: "revealed", label: option.label, percent: option.percent, cost: option.cost, baseCost: MEDTECH_QUESTION_PACKAGE_COST, retryAt: option.percent === 100 ? new Date(Date.now() + MEDTECH_AUDIO_ACCESS_HOURS * 60 * 60 * 1000).toISOString() : null, quizAttemptsUsed: current.quizAttemptsUsed ?? 0, quizAttemptsRemaining: current.quizAttemptsRemaining ?? MEDTECH_PACK_QUIZ_ATTEMPT_LIMIT } satisfies MedtechPackDiscountReward;
}

export async function createMedtechPackQuizReward(
  db: Awaited<ReturnType<typeof getDb>>,
  userKey: string,
  packageName: string,
  packageNumber: number,
  score: number,
  total: number,
  averageSeconds: number,
) {
  const current = await getMedtechPackDiscountReward(db, userKey, packageName, packageNumber);
  const canUseChallenge = current.quizAttemptsRemaining === undefined || current.quizAttemptsRemaining > 0;
  const canImproveExistingChallenge = (current.quizAttemptsUsed ?? 0) > 0 && current.status === "revealed";
  if (!canUseChallenge || (current.status !== "available" && !canImproveExistingChallenge && !(current.status === "revealed" && current.percent === 100))) return current;
  const usage = await getOrCreateMedtechUsage(db, userKey);
  const normalizedScore = Math.max(0, Math.min(total, Math.floor(score)));
  const normalizedTotal = Math.max(1, Math.floor(total));
  const normalizedAverage = Number.isFinite(averageSeconds) ? Math.max(0, Math.min(5, averageSeconds)) : 5;
  const ratio = normalizedScore / normalizedTotal;
  const speedBonus = normalizedAverage <= 3;
  const option = ratio >= 0.9
    ? MEDTECH_PACK_DISCOUNT_OPTIONS[0]
    : ratio >= 0.7 && speedBonus
    ? MEDTECH_PACK_DISCOUNT_OPTIONS[0]
    : ratio >= 0.7
    ? MEDTECH_PACK_DISCOUNT_OPTIONS[1]
    : ratio >= 0.5 && speedBonus
    ? MEDTECH_PACK_DISCOUNT_OPTIONS[1]
    : ratio >= 0.5
    ? MEDTECH_PACK_DISCOUNT_OPTIONS[2]
    : MEDTECH_PACK_DISCOUNT_OPTIONS[3];
  await db.insert(medtechPointLedger).values({
    userKey,
    delta: 0,
    balanceAfter: usage.aiCredits,
    action: "question_pack_quiz",
    description: medtechPackDiscountDescription(packageName, packageNumber),
    sourceDetail: `答題挑戰第 ${(current.quizAttemptsUsed ?? 0) + 1}/${MEDTECH_PACK_QUIZ_ATTEMPT_LIMIT} 次：${normalizedTotal} 題答對 ${normalizedScore} 題；平均作答時間：${normalizedAverage.toFixed(1)} 秒；結果：${option.label}；折扣：${option.percent}折；優惠價 ${option.cost} 點；每個題目包最多兩次機會。`,
  });
  return await getMedtechPackDiscountReward(db, userKey, packageName, packageNumber);
}

export function normalizeMedtechUserKey(value: string) {
  return value.trim().toLowerCase() || "default-owner";
}

export function medtechUserKey(request: Request) {
  return normalizeMedtechUserKey(request.headers.get("oai-authenticated-user-email") || "");
}

export async function getOrCreateMedtechUsage(db: Awaited<ReturnType<typeof getDb>>, userKey: string) {
  const normalizedKey = normalizeMedtechUserKey(userKey);
  const [exact] = await db.select().from(medtechUsage)
    .where(eq(medtechUsage.userKey, normalizedKey))
    .orderBy(desc(medtechUsage.updatedAt), desc(medtechUsage.id))
    .limit(1);
  // Older records may contain a casing or whitespace variant of the same
  // email. Use the most recently updated matching balance so every page sees
  // the same account balance while those legacy rows remain recoverable.
  const existing = exact ?? (await db.select().from(medtechUsage))
    .filter((row) => normalizeMedtechUserKey(row.userKey) === normalizedKey)
    .sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime() || right.id - left.id)[0];
  if (existing) {
    // A previous admin test was submitted through the platform screenshot
    // service, which created a separate technical account and received the
    // user's 610 points. Move that orphaned balance to the real owner once,
    // preserving both sides in the ledger so the repair is auditable and
    // idempotent.
    if (normalizedKey === MEDTECH_OWNER_USER_KEY) {
      const [serviceUsage] = await db.select().from(medtechUsage)
        .where(eq(medtechUsage.userKey, MEDTECH_SCREENSHOT_SERVICE_USER_KEY))
        .limit(1);
      const serviceBalance = serviceUsage?.aiCredits ?? 0;
      if (serviceUsage && serviceBalance > 0) {
        const ownerNextCredits = existing.aiCredits + serviceBalance;
        const [updatedService] = await db.update(medtechUsage)
          .set({ aiCredits: 0, updatedAt: new Date() })
          .where(and(eq(medtechUsage.id, serviceUsage.id), gte(medtechUsage.aiCredits, serviceBalance)))
          .returning();
        if (updatedService) {
          const [updatedOwner] = await db.update(medtechUsage)
            .set({ aiCredits: ownerNextCredits, updatedAt: new Date() })
            .where(eq(medtechUsage.id, existing.id))
            .returning();
          if (updatedOwner) {
            await db.insert(medtechPointLedger).values([
              {
                userKey: MEDTECH_SCREENSHOT_SERVICE_USER_KEY,
                delta: -serviceBalance,
                balanceAfter: 0,
                action: "admin_transfer_out",
                description: `系統帳號誤收點數，轉回 ${MEDTECH_OWNER_USER_KEY}`,
                sourceDetail: "一次性資料修復：原管理員加點紀錄保留於本帳號明細。",
              },
              {
                userKey: MEDTECH_OWNER_USER_KEY,
                delta: serviceBalance,
                balanceAfter: ownerNextCredits,
                action: "admin_transfer_in",
                description: "從系統截圖服務帳號轉回本人帳號",
                sourceDetail: `轉入 ${serviceBalance} 點；原加點明細保留於系統帳號。`,
              },
            ]);
            return updatedOwner;
          }
        }
      }
    }
    // The ledger is the audit trail for every grant and spend. If the cached
    // balance was reset or became stale, reconstruct it from the ledger before
    // returning it so the admin page, account page and learning APIs agree.
    const ledgerKeys = [...new Set([normalizedKey, existing.userKey])];
    const ledgerRows = await db.select({ delta: medtechPointLedger.delta })
      .from(medtechPointLedger)
      .where(and(inArray(medtechPointLedger.userKey, ledgerKeys), ne(medtechPointLedger.delta, 0)));
    const reconstructed = ledgerRows.reduce((total, row) => total + row.delta, 0);
    if (Number.isFinite(reconstructed)) {
      const repairedBalance = Math.max(0, Math.trunc(reconstructed));
      if (repairedBalance !== existing.aiCredits) {
        const [repaired] = await db.update(medtechUsage)
          .set({ aiCredits: repairedBalance, updatedAt: new Date() })
          .where(eq(medtechUsage.id, existing.id))
          .returning();
        return repaired ?? { ...existing, aiCredits: repairedBalance };
      }
    }
    return existing;
  }
  const [created] = await db.insert(medtechUsage).values({ userKey: normalizedKey, aiCredits: MEDTECH_STARTING_POINTS }).returning();
  await db.insert(medtechPointLedger).values({
    userKey: normalizedKey,
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
  const normalizedKey = normalizeMedtechUserKey(userKey);
  const usage = await getOrCreateMedtechUsage(db, normalizedKey);
  const safeAmount = Math.max(1, Math.floor(amount));
  const nextCredits = usage.aiCredits + safeAmount;
  const [updated] = await db.update(medtechUsage).set({ aiCredits: nextCredits, updatedAt: new Date() }).where(eq(medtechUsage.id, usage.id)).returning();
  if (!updated) return null;
  await db.insert(medtechPointLedger).values({ userKey: normalizedKey, delta: safeAmount, balanceAfter: nextCredits, action: "admin_grant", description });
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
  options: { packageNumber?: number; allowCharge?: boolean } = {},
) {
  const packageNumber = Math.max(1, Math.floor(options.packageNumber ?? 1));
  const allowCharge = options.allowCharge ?? false;
  const candidateIds = [...new Set(questionIds.filter((id) => Number.isInteger(id) && id > 0))].slice(0, MEDTECH_QUESTION_PACKAGE_SIZE);
  const usage = await getOrCreateMedtechUsage(db, userKey);
  const description = medtechPackDescription(packageName, packageNumber);
  const legacyDescription = `${packageName}題目包（7 天內可隨意刷）`;
  const descriptions = packageNumber === 1 ? [description, legacyDescription] : [description];
  const isBonusPack = candidateIds.length < MEDTECH_QUESTION_PACKAGE_SIZE;
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
      inArray(medtechPointLedger.description, descriptions),
      gte(medtechPointLedger.createdAt, cutoff),
      or(gte(medtechPointLedger.availableUntil, new Date()), and(isNull(medtechPointLedger.availableUntil), gte(medtechPointLedger.createdAt, cutoff))),
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
      discountReward: { status: "used", label: null, percent: null, cost: MEDTECH_QUESTION_PACKAGE_COST, baseCost: MEDTECH_QUESTION_PACKAGE_COST } satisfies MedtechPackDiscountReward,
      availableUntil,
      packageNumber,
      isBonusPack,
    };
  }
  if (!candidateIds.length) {
    return { usage, allowedIds: [], packageQuestionIds: [], limited: false, hasAccess: false, charged: false, gifted: false, packageCost: MEDTECH_QUESTION_PACKAGE_COST, availableUntil: null, packageNumber, isBonusPack };
  }

  // 闖關包依序開放：上一包必須完成，才可以解鎖下一包。
  let previousCompleted = true;
  if (packageNumber > 1) {
    const [prior] = await db.select({ id: medtechPracticeSessions.id })
      .from(medtechPracticeSessions)
      .where(and(
        eq(medtechPracticeSessions.userKey, userKey),
        eq(medtechPracticeSessions.packageName, packageName),
        eq(medtechPracticeSessions.packNumber, packageNumber - 1),
        isNotNull(medtechPracticeSessions.completedAt),
      ))
      .limit(1);
    previousCompleted = Boolean(prior);
  }
  if (!previousCompleted) {
    return { usage, allowedIds: candidateIds, packageQuestionIds: candidateIds, limited: true, hasAccess: false, charged: false, gifted: false, packageCost: MEDTECH_QUESTION_PACKAGE_COST, discountReward: { status: "available", label: null, percent: null, cost: MEDTECH_QUESTION_PACKAGE_COST, baseCost: MEDTECH_QUESTION_PACKAGE_COST } satisfies MedtechPackDiscountReward, availableUntil: null, packageNumber, isBonusPack, blockedByPrevious: true };
  }

  // 每個帳號只有一次免費題目包。學員可先選章節或隨機模考的一包，
  // 免費資格使用後，其餘題目包（包含不足 30 題的尾包）都依 30 點解鎖。
  const [freePackageUsed] = await db.select({ id: medtechPointLedger.id })
    .from(medtechPointLedger)
    .where(and(
      eq(medtechPointLedger.userKey, userKey),
      eq(medtechPointLedger.action, "question_pack_gift"),
      like(medtechPointLedger.sourceDetail, "%首次體驗贈送%"),
    ))
    .limit(1);
  const discountReward = freePackageUsed
    ? await getMedtechPackDiscountReward(db, userKey, packageName, packageNumber)
    : null;
  const packageCost = discountReward?.status === "revealed" ? discountReward.cost : MEDTECH_QUESTION_PACKAGE_COST;
  const packageSource = (gift: boolean) => `題目包：${packageName}第 ${packageNumber} 包；${gift ? "首次體驗贈送，不扣點" : discountReward?.status === "revealed" ? `轉轉樂${discountReward.label}，優惠價 ${packageCost} 點（原價 ${MEDTECH_QUESTION_PACKAGE_COST} 點）` : `一次購足 ${MEDTECH_QUESTION_PACKAGE_COST} 點`}；7 天內隨意刷；固定題目：${candidateIds.join(",")}`;
  const shouldGift = !freePackageUsed;
  if (shouldGift) {
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
    return { usage, allowedIds: candidateIds, packageQuestionIds: candidateIds, limited: false, hasAccess: true, charged: false, gifted: true, packageCost: MEDTECH_QUESTION_PACKAGE_COST, discountReward: null, availableUntil: giftUntil, packageNumber, isBonusPack };
  }
  if (usage.aiCredits < packageCost) {
    return { usage, allowedIds: candidateIds, packageQuestionIds: candidateIds, limited: true, hasAccess: false, charged: false, gifted: false, packageCost, discountReward, availableUntil: null, packageNumber, isBonusPack };
  }
  if (!allowCharge) {
    return { usage, allowedIds: candidateIds, packageQuestionIds: candidateIds, limited: true, hasAccess: false, charged: false, gifted: false, packageCost, discountReward, availableUntil: null, packageNumber, isBonusPack, needsUnlock: true };
  }
  const updated = await spendMedtechPoints(db, usage, {
    action: "question_pack",
    description,
    sourceDetail: packageSource(false),
    retainHours: MEDTECH_QUESTION_PACKAGE_HOURS,
    amount: packageCost,
  });
  if (!updated) return { usage, allowedIds: candidateIds, packageQuestionIds: candidateIds, limited: true, hasAccess: false, charged: false, gifted: false, packageCost, discountReward, availableUntil: null, packageNumber, isBonusPack };
  const paidUntil = new Date(Date.now() + MEDTECH_QUESTION_PACKAGE_HOURS * 60 * 60 * 1000);
  return { usage: updated, allowedIds: candidateIds, packageQuestionIds: candidateIds, limited: false, hasAccess: true, charged: true, gifted: false, packageCost, discountReward: discountReward ? { ...discountReward, status: "used" as const } : null, availableUntil: paidUntil, packageNumber, isBonusPack };
}

export function audioTrialIds(row: { audioTrialQuestionIdsJson: string }) {
  try {
    const ids = JSON.parse(row.audioTrialQuestionIdsJson || "[]") as unknown;
    return Array.isArray(ids) ? ids.filter((id): id is number => Number.isInteger(id) && id > 0) : [];
  } catch {
    return [];
  }
}
