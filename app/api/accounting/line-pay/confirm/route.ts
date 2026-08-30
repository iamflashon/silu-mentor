import { and, eq } from "drizzle-orm";
import { accountingMemberEntitlements, medtechPaymentOrders } from "../../../../../db/schema";
import { requireMember } from "../../../../../lib/member-auth";
import { linePayPost } from "../../../../../lib/line-pay";
import { getAccountingProductSettings, ACCOUNTING_FIRST_PRODUCT_KEY } from "../../../../../lib/accounting-product-settings";

export async function GET(request: Request) {
  const auth = await requireMember(request); if ("error" in auth) return auth.error;
  const url = new URL(request.url), orderId = url.searchParams.get("orderId")?.trim() ?? "", callbackTransactionId = url.searchParams.get("transactionId")?.trim() ?? "";
  const [order] = await auth.db.select().from(medtechPaymentOrders).where(and(eq(medtechPaymentOrders.orderId, orderId), eq(medtechPaymentOrders.userKey, auth.userKey))).limit(1);
  const destination = "/accounting/practice";
  if (!order || !order.packageName.startsWith("accounting:")) return Response.redirect(`${url.origin}${destination}?payment=missing`);
  if (order.status === "paid") return Response.redirect(`${url.origin}${destination}?payment=success`);
  const transactionId = callbackTransactionId || order.transactionId || "";
  if (!transactionId || (order.transactionId && callbackTransactionId && order.transactionId !== callbackTransactionId)) return Response.redirect(`${url.origin}${destination}?payment=invalid`);
  try {
    const result = await linePayPost(`/v3/payments/${transactionId}/confirm`, { amount: order.amount, currency: order.currency }); const paid = result.returnCode === "0000";
    await auth.db.update(medtechPaymentOrders).set({ transactionId, status: paid ? "paid" : "failed", returnCode: result.returnCode ?? null, returnMessage: result.returnMessage ?? null, paidAt: paid ? new Date() : null, updatedAt: new Date() }).where(eq(medtechPaymentOrders.id, order.id));
    if (paid) { const product = await getAccountingProductSettings(auth.db), now = new Date(); const [current] = await auth.db.select().from(accountingMemberEntitlements).where(and(eq(accountingMemberEntitlements.memberId, auth.member.id), eq(accountingMemberEntitlements.productKey, ACCOUNTING_FIRST_PRODUCT_KEY))).limit(1); const base = current?.status === "active" && current.expiresAt > now ? current.expiresAt : now; const expiresAt = new Date(base.getTime() + product.accessDays * 86400000); await auth.db.insert(accountingMemberEntitlements).values({ memberId: auth.member.id, productKey: ACCOUNTING_FIRST_PRODUCT_KEY, status: "active", source: "line_pay", startsAt: now, expiresAt, note: `LINE Pay ${order.amount} 元開通 ${product.accessDays} 天`, updatedBy: "line_pay" }).onConflictDoUpdate({ target: [accountingMemberEntitlements.memberId, accountingMemberEntitlements.productKey], set: { status: "active", source: "line_pay", expiresAt, note: `LINE Pay ${order.amount} 元開通 ${product.accessDays} 天`, updatedBy: "line_pay", updatedAt: now } }); }
    return Response.redirect(`${url.origin}${destination}?payment=${paid ? "success" : "failed"}`);
  } catch { return Response.redirect(`${url.origin}${destination}?payment=failed`); }
}
