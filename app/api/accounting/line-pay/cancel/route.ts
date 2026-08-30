import { and, eq } from "drizzle-orm";
import { medtechPaymentOrders } from "../../../../../db/schema";
import { requireMember } from "../../../../../lib/member-auth";

export async function GET(request: Request) {
  const auth = await requireMember(request);
  if ("error" in auth) return auth.error;
  const url = new URL(request.url);
  const orderId = url.searchParams.get("orderId")?.trim() ?? "";
  let destination = "/accounting/practice";
  if (orderId) {
    const [order] = await auth.db
      .select({ packageName: medtechPaymentOrders.packageName })
      .from(medtechPaymentOrders)
      .where(
        and(
          eq(medtechPaymentOrders.orderId, orderId),
          eq(medtechPaymentOrders.userKey, auth.userKey),
        ),
      )
      .limit(1);
    if (order?.packageName === "accounting:ai") destination = "/accounting/qa";
    await auth.db
      .update(medtechPaymentOrders)
      .set({ status: "cancelled", updatedAt: new Date() })
      .where(
        and(
          eq(medtechPaymentOrders.orderId, orderId),
          eq(medtechPaymentOrders.userKey, auth.userKey),
        ),
      );
  }
  return Response.redirect(`${url.origin}${destination}?payment=cancelled`);
}
