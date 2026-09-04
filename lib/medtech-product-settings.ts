import { and, desc, eq, gt } from "drizzle-orm";
import type { getDb } from "../db";
import { appSettings, medtechMemberEntitlements, medtechPaymentOrders, medtechProducts, members } from "../db/schema";

export const MEDTECH_DEFAULT_PRODUCT_KEY = "medtech-iii-clinical-virology-lower";
export const MEDTECH_DEFAULT_PRODUCT_TITLE = "醫檢師國考題詳解（Ⅲ）臨床病毒學（下）";
export const MEDTECH_DESCRIPTION_SETTING_KEY = `medtech_product_description:${MEDTECH_DEFAULT_PRODUCT_KEY}`;

export type MedtechProductSettings = {
  productKey: string;
  title: string;
  descriptionHtml: string;
  listPrice: number;
  salePrice: number | null;
  saleLabel: string;
  saleStartsAt: Date | null;
  saleEndsAt: Date | null;
  accessDays: number;
  trialQuestions: number;
  status: string;
  effectivePrice: number;
  saleActive: boolean;
};

export async function getMedtechProductSettings(db: Awaited<ReturnType<typeof getDb>>, now = new Date()): Promise<MedtechProductSettings> {
  let [row] = await db.select().from(medtechProducts).where(eq(medtechProducts.productKey, MEDTECH_DEFAULT_PRODUCT_KEY)).limit(1);
  if (!row) {
    [row] = await db.insert(medtechProducts).values({ productKey: MEDTECH_DEFAULT_PRODUCT_KEY, title: MEDTECH_DEFAULT_PRODUCT_TITLE }).onConflictDoNothing().returning();
    if (!row) [row] = await db.select().from(medtechProducts).where(eq(medtechProducts.productKey, MEDTECH_DEFAULT_PRODUCT_KEY)).limit(1);
  }
  const [descriptionSetting] = await db.select().from(appSettings).where(eq(appSettings.key, MEDTECH_DESCRIPTION_SETTING_KEY)).limit(1);
  const defaultDescription = "<p>1,400+ 題｜每 30 題一個練習單元｜章節刷題、跨章節模考、全真模擬、錯題重練、完整解析與康情老師語音。</p>";
  const fallback = { productKey: MEDTECH_DEFAULT_PRODUCT_KEY, title: MEDTECH_DEFAULT_PRODUCT_TITLE, listPrice: 199, salePrice: null, saleLabel: "", saleStartsAt: null, saleEndsAt: null, accessDays: 30, trialQuestions: 30, status: "active" };
  const product = row ?? fallback;
  const startsOk = !product.saleStartsAt || product.saleStartsAt.getTime() <= now.getTime();
  const endsOk = !product.saleEndsAt || product.saleEndsAt.getTime() >= now.getTime();
  const saleActive = product.salePrice !== null && product.salePrice > 0 && product.salePrice < product.listPrice && startsOk && endsOk;
  return { ...product, descriptionHtml: descriptionSetting?.value || defaultDescription, effectivePrice: saleActive ? product.salePrice! : product.listPrice, saleActive };
}

export async function getMemberProductEntitlement(db: Awaited<ReturnType<typeof getDb>>, userKey: string, now = new Date()) {
  let [row] = await db.select({ entitlement: medtechMemberEntitlements, email: members.email })
    .from(medtechMemberEntitlements)
    .innerJoin(members, eq(medtechMemberEntitlements.memberId, members.id))
    .where(and(eq(members.email, userKey.trim().toLowerCase()), eq(medtechMemberEntitlements.productKey, MEDTECH_DEFAULT_PRODUCT_KEY), eq(medtechMemberEntitlements.status, "active"), gt(medtechMemberEntitlements.expiresAt, now)))
    .limit(1);
  if (row?.entitlement) return row.entitlement;
  const email = userKey.trim().toLowerCase();
  const [member] = await db.select().from(members).where(eq(members.email, email)).limit(1);
  if (!member) return null;
  const [paidOrder] = await db.select().from(medtechPaymentOrders)
    .where(and(eq(medtechPaymentOrders.userKey, email), eq(medtechPaymentOrders.status, "paid")))
    .orderBy(desc(medtechPaymentOrders.paidAt), desc(medtechPaymentOrders.createdAt))
    .limit(1);
  if (!paidOrder || paidOrder.activatedAt) return null;
  const product = await getMedtechProductSettings(db, now);
  const startsAt = paidOrder.paidAt ?? now;
  const expiresAt = new Date(startsAt.getTime() + product.accessDays * 86400000);
  if (expiresAt <= now) return null;
  const [recovered] = await db.insert(medtechMemberEntitlements).values({
    memberId: member.id,
    productKey: MEDTECH_DEFAULT_PRODUCT_KEY,
    status: "active",
    source: "line_pay_recovered",
    startsAt,
    expiresAt,
    note: `自動補開通 LINE Pay 訂單 ${paidOrder.orderId}`,
    updatedBy: "line_pay_recovery",
  }).onConflictDoUpdate({
    target: [medtechMemberEntitlements.memberId, medtechMemberEntitlements.productKey],
    set: { status: "active", source: "line_pay_recovered", startsAt, expiresAt, note: `自動補開通 LINE Pay 訂單 ${paidOrder.orderId}`, updatedBy: "line_pay_recovery", updatedAt: now },
  }).returning();
  await db.update(medtechPaymentOrders).set({ activatedAt: now, updatedAt: now }).where(eq(medtechPaymentOrders.id, paidOrder.id));
  return recovered ?? null;
}

export function parseMedtechPermissions(value: string | null | undefined) {
  try {
    const parsed = JSON.parse(value || "[]") as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch { return []; }
}
