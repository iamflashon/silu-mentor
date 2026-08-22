import { and, eq, gt } from "drizzle-orm";
import type { getDb } from "../db";
import { medtechMemberEntitlements, medtechProducts, members } from "../db/schema";

export const MEDTECH_DEFAULT_PRODUCT_KEY = "medtech-iii-clinical-virology-lower";
export const MEDTECH_DEFAULT_PRODUCT_TITLE = "醫檢師國考題詳解（Ⅲ）臨床病毒學（下）";

export type MedtechProductSettings = {
  productKey: string;
  title: string;
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
  const fallback = { productKey: MEDTECH_DEFAULT_PRODUCT_KEY, title: MEDTECH_DEFAULT_PRODUCT_TITLE, listPrice: 199, salePrice: null, saleLabel: "", saleStartsAt: null, saleEndsAt: null, accessDays: 30, trialQuestions: 30, status: "active" };
  const product = row ?? fallback;
  const startsOk = !product.saleStartsAt || product.saleStartsAt.getTime() <= now.getTime();
  const endsOk = !product.saleEndsAt || product.saleEndsAt.getTime() >= now.getTime();
  const saleActive = product.salePrice !== null && product.salePrice > 0 && product.salePrice < product.listPrice && startsOk && endsOk;
  return { ...product, effectivePrice: saleActive ? product.salePrice! : product.listPrice, saleActive };
}

export async function getMemberProductEntitlement(db: Awaited<ReturnType<typeof getDb>>, userKey: string, now = new Date()) {
  const [row] = await db.select({ entitlement: medtechMemberEntitlements, email: members.email })
    .from(medtechMemberEntitlements)
    .innerJoin(members, eq(medtechMemberEntitlements.memberId, members.id))
    .where(and(eq(members.email, userKey.trim().toLowerCase()), eq(medtechMemberEntitlements.productKey, MEDTECH_DEFAULT_PRODUCT_KEY), eq(medtechMemberEntitlements.status, "active"), gt(medtechMemberEntitlements.expiresAt, now)))
    .limit(1);
  return row?.entitlement ?? null;
}

export function parseMedtechPermissions(value: string | null | undefined) {
  try {
    const parsed = JSON.parse(value || "[]") as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch { return []; }
}
