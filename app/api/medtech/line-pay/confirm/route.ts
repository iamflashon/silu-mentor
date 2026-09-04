import { and, eq } from "drizzle-orm";
import { getDb } from "../../../../../db";
import { medtechMemberEntitlements, medtechPaymentOrders, members } from "../../../../../db/schema";
import { linePayPost } from "../../../../../lib/line-pay";
import { getMedtechProductSettings, MEDTECH_DEFAULT_PRODUCT_KEY } from "../../../../../lib/medtech-product-settings";

export async function GET(request: Request) {
  const db = await getDb();
  const url = new URL(request.url);
  const orderId = url.searchParams.get("orderId")?.trim() ?? "";
  const callbackTransactionId =
    url.searchParams.get("transactionId")?.trim() ?? "";
  const [order] = await db
    .select()
    .from(medtechPaymentOrders)
    .where(eq(medtechPaymentOrders.orderId, orderId))
    .limit(1);
  const destination = "/medtech/chapters";
  if (!order)
    return Response.redirect(`${url.origin}/medtech/chapters?payment=missing`);
  const [member] = await db.select().from(members).where(eq(members.email, order.userKey.trim().toLowerCase())).limit(1);
  if (!member)
    return Response.redirect(`${url.origin}${destination}?payment=member_missing`);
  async function activatePaidOrder() {
    const product = await getMedtechProductSettings(db);
    const now = new Date();
    const [existing] = await db
      .select()
      .from(medtechMemberEntitlements)
      .where(and(eq(medtechMemberEntitlements.memberId, member.id), eq(medtechMemberEntitlements.productKey, MEDTECH_DEFAULT_PRODUCT_KEY)))
      .limit(1);
    const startsAt = existing?.startsAt ?? order.paidAt ?? now;
    const base = existing?.status === "active" && existing.expiresAt > now ? existing.expiresAt : now;
    const expiresAt = new Date(base.getTime() + product.accessDays * 86400000);
    await db.insert(medtechMemberEntitlements).values({
      memberId: member.id,
      productKey: MEDTECH_DEFAULT_PRODUCT_KEY,
      status: "active",
      source: "line_pay",
      startsAt,
      expiresAt,
      note: `LINE Pay ${order.amount} 元開通 ${product.accessDays} 天`,
      updatedBy: "line_pay",
    }).onConflictDoUpdate({
      target: [medtechMemberEntitlements.memberId, medtechMemberEntitlements.productKey],
      set: { status: "active", source: "line_pay", startsAt, expiresAt, note: `LINE Pay ${order.amount} 元開通 ${product.accessDays} 天`, updatedBy: "line_pay", updatedAt: now },
    });
    await db.update(medtechPaymentOrders).set({ activatedAt: now, updatedAt: now }).where(eq(medtechPaymentOrders.id, order.id));
  }
  if (order.status === "paid") {
    try {
      if (!order.activatedAt) await activatePaidOrder();
      return Response.redirect(`${url.origin}${destination}?payment=success`);
    } catch {
      return Response.redirect(`${url.origin}${destination}?payment=activation_failed&orderId=${encodeURIComponent(order.orderId)}`);
    }
  }
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
    await db
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
      await activatePaidOrder();
    }
    return Response.redirect(
      `${url.origin}${destination}?payment=${paid ? "success" : "failed"}&pack=${order.packNumber}`,
    );
  } catch {
    return Response.redirect(`${url.origin}${destination}?payment=failed`);
  }
}
