import { and, eq } from "drizzle-orm";
import {
  accountingMemberEntitlements,
  medtechPaymentOrders,
} from "../../../../../db/schema";
import { requireMember } from "../../../../../lib/member-auth";
import { linePayPost } from "../../../../../lib/line-pay";
import {
  getAccountingProductSettings,
  ACCOUNTING_FIRST_PRODUCT_KEY,
} from "../../../../../lib/accounting-product-settings";
import { grantAccountingAi } from "../../../../../lib/accounting-ai-access";

export async function GET(request: Request) {
  const auth = await requireMember(request);
  if ("error" in auth) return auth.error;
  const url = new URL(request.url),
    orderId = url.searchParams.get("orderId")?.trim() ?? "",
    callbackTransactionId = url.searchParams.get("transactionId")?.trim() ?? "";
  const [order] = await auth.db
    .select()
    .from(medtechPaymentOrders)
    .where(
      and(
        eq(medtechPaymentOrders.orderId, orderId),
        eq(medtechPaymentOrders.userKey, auth.userKey),
      ),
    )
    .limit(1);
  const destination =
    order?.packageName === "accounting:ai"
      ? "/accounting/qa"
      : "/accounting/practice";
  if (!order || !order.packageName.startsWith("accounting:"))
    return Response.redirect(`${url.origin}${destination}?payment=missing`);
  if (order.status === "paid")
    return Response.redirect(`${url.origin}${destination}?payment=success`);
  const transactionId = callbackTransactionId || order.transactionId || "";
  if (
    !transactionId ||
    (order.transactionId &&
      callbackTransactionId &&
      order.transactionId !== callbackTransactionId)
  )
    return Response.redirect(`${url.origin}${destination}?payment=invalid`);
  try {
    const result = await linePayPost(`/v3/payments/${transactionId}/confirm`, {
      amount: order.amount,
      currency: order.currency,
    });
    const paid = result.returnCode === "0000";
    await auth.db
      .update(medtechPaymentOrders)
      .set({
        transactionId,
        status: paid ? "paid" : "failed",
        returnCode: result.returnCode ?? null,
        returnMessage: result.returnMessage ?? null,
        paidAt: paid ? new Date() : null,
        updatedAt: new Date(),
      })
      .where(eq(medtechPaymentOrders.id, order.id));
    if (paid && order.packageName === "accounting:ai")
      await grantAccountingAi(auth.db, auth.member.id, order.orderId);
    else if (paid) {
      const product = await getAccountingProductSettings(auth.db),
        now = new Date(),
        chapterPlan = order.packageName.startsWith("accounting:chapter:"),
        entitlementKey = chapterPlan
          ? `${ACCOUNTING_FIRST_PRODUCT_KEY}:chapter:${order.packNumber}`
          : ACCOUNTING_FIRST_PRODUCT_KEY,
        accessDays = chapterPlan ? 30 : product.accessDays;
      const [current] = await auth.db
        .select()
        .from(accountingMemberEntitlements)
        .where(
          and(
            eq(accountingMemberEntitlements.memberId, auth.member.id),
            eq(accountingMemberEntitlements.productKey, entitlementKey),
          ),
        )
        .limit(1);
      const base =
        current?.status === "active" && current.expiresAt > now
          ? current.expiresAt
          : now;
      const expiresAt = new Date(base.getTime() + accessDays * 86400000);
      await auth.db
        .insert(accountingMemberEntitlements)
        .values({
          memberId: auth.member.id,
          productKey: entitlementKey,
          status: "active",
          source: "line_pay",
          startsAt: now,
          expiresAt,
          note: `LINE Pay ${order.amount} 元開通${chapterPlan ? `第 ${order.packNumber} 章` : "整本"} ${accessDays} 天`,
          updatedBy: "line_pay",
        })
        .onConflictDoUpdate({
          target: [
            accountingMemberEntitlements.memberId,
            accountingMemberEntitlements.productKey,
          ],
          set: {
            status: "active",
            source: "line_pay",
            expiresAt,
            note: `LINE Pay ${order.amount} 元開通${chapterPlan ? `第 ${order.packNumber} 章` : "整本"} ${accessDays} 天`,
            updatedBy: "line_pay",
            updatedAt: now,
          },
        });
    }
    return Response.redirect(
      `${url.origin}${destination}?payment=${paid ? "success" : "failed"}`,
    );
  } catch {
    return Response.redirect(`${url.origin}${destination}?payment=failed`);
  }
}
