import { and, eq } from "drizzle-orm";
import { medtechPaymentOrders } from "../../../../../db/schema";
import { requireMedtechMember } from "../../../../../lib/member-auth";
import { linePayPost } from "../../../../../lib/line-pay";

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
  if (!order)
    return Response.redirect(`${url.origin}/medtech/chapters?payment=missing`);
  if (order.status === "paid")
    return Response.redirect(`${url.origin}/medtech/chapters?payment=success`);
  const transactionId = callbackTransactionId || order.transactionId || "";
  if (
    !transactionId ||
    (order.transactionId &&
      callbackTransactionId &&
      order.transactionId !== callbackTransactionId)
  ) {
    return Response.redirect(`${url.origin}/medtech/chapters?payment=invalid`);
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
    return Response.redirect(
      `${url.origin}/medtech/chapters?payment=${paid ? "success" : "failed"}&pack=${order.packNumber}`,
    );
  } catch {
    return Response.redirect(`${url.origin}/medtech/chapters?payment=failed`);
  }
}
