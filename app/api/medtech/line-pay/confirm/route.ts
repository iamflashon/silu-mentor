import { and, eq } from "drizzle-orm";
import { medtechMemberEntitlements, medtechPaymentOrders } from "../../../../../db/schema";
import { requireMedtechMember } from "../../../../../lib/member-auth";
import { linePayPost } from "../../../../../lib/line-pay";
import { getMedtechProductSettings, MEDTECH_DEFAULT_PRODUCT_KEY } from "../../../../../lib/medtech-product-settings";

export async function GET(request: Request) {
  const auth = await requireMedtechMember(request);
  if ("error" in auth) return auth.error;
  const url = new URL(request.url);
  const orderId = url.searchParams.get("orderId")?.trim() ?? "";
  const callbackTransactionId =
    url.searchParams.get("transactionId")?.trim() ?? "";
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
  const destination = "/medtech/chapters";
  if (!order)
    return Response.redirect(`${url.origin}/medtech/chapters?payment=missing`);
  if (order.status === "paid")
    return Response.redirect(`${url.origin}${destination}?payment=success`);
  const transactionId = callbackTransactionId || order.transactionId || "";
  if (
    !transactionId ||
    (order.transactionId &&
      callbackTransactionId &&
      order.transactionId !== callbackTransactionId)
  ) {
    return Response.redirect(`${url.origin}${destination}?payment=invalid`);
  }
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
    if (paid) {
      const product = await getMedtechProductSettings(auth.db);
      const now = new Date();
      const expiresAt = new Date(now.getTime() + product.accessDays * 86400000);
      await auth.db.insert(medtechMemberEntitlements).values({
        memberId: auth.member.id,
        productKey: MEDTECH_DEFAULT_PRODUCT_KEY,
        status: "active",
        source: "line_pay",
        startsAt: now,
        expiresAt,
        note: `LINE Pay ${order.amount} 元開通 ${product.accessDays} 天`,
        updatedBy: "line_pay",
      }).onConflictDoUpdate({
        target: [medtechMemberEntitlements.memberId, medtechMemberEntitlements.productKey],
        set: { status: "active", source: "line_pay", startsAt: now, expiresAt, note: `LINE Pay ${order.amount} 元開通 ${product.accessDays} 天`, updatedBy: "line_pay", updatedAt: now },
      });
    }
    return Response.redirect(
      `${url.origin}${destination}?payment=${paid ? "success" : "failed"}&pack=${order.packNumber}`,
    );
  } catch {
    return Response.redirect(`${url.origin}${destination}?payment=failed`);
  }
}
