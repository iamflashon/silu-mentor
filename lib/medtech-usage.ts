import { and, desc, eq, gte, inArray } from "drizzle-orm";
import type { getDb } from "../db";
import { medtechPointLedger, medtechUsage } from "../db/schema";

// 醫檢師平台統一使用點數：首次登入贈 10 點，提示與比較選項走快取，
// 語音完整解析與 AI 追問各自按次扣 1 點。保留舊欄位讀取僅為相容既有資料。
export const MEDTECH_AUDIO_TRIAL_LIMIT = 0;
export const MEDTECH_STARTING_POINTS = 10;
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
  details: { action: string; description: string; questionId?: number; amount?: number },
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
  });
  return updated;
}

export async function consumeMedtechFeature(
  db: Awaited<ReturnType<typeof getDb>>,
  usage: { id: number; userKey: string; aiCredits: number },
  details: { action: string; description: string; questionId?: number; reuseWithinHours?: number },
) {
  if (details.questionId && details.reuseWithinHours) {
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
  const updated = await spendMedtechPoints(db, usage, details);
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
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
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
  const newIds = uniqueIds.filter((id) => !freeIds.has(id));
  const chargeableIds = newIds.slice(0, Math.max(0, usage.aiCredits));
  let current = usage;
  const chargedIds: number[] = [];
  for (const questionId of chargeableIds) {
    const updated = await spendMedtechPoints(db, current, { action: "question_view", description: "查看題目（24 小時內可重看）", questionId });
    if (!updated) break;
    current = updated;
    chargedIds.push(questionId);
  }
  const allowedIds = new Set([...freeIds, ...chargedIds]);
  return { usage: current, allowedIds: uniqueIds.filter((id) => allowedIds.has(id)), limited: allowedIds.size < uniqueIds.length };
}

export function audioTrialIds(row: { audioTrialQuestionIdsJson: string }) {
  try {
    const ids = JSON.parse(row.audioTrialQuestionIdsJson || "[]") as unknown;
    return Array.isArray(ids) ? ids.filter((id): id is number => Number.isInteger(id) && id > 0) : [];
  } catch {
    return [];
  }
}
