import { and, eq } from "drizzle-orm";
import { medtechPaymentOrders } from "../../../../../db/schema";
import { requireMedtechMember } from "../../../../../lib/member-auth";

export async function GET(request: Request) {
  const auth = await requireMedtechMember(request);
  if ("error" in auth) return auth.error;
  const url = new URL(request.url);
  const orderId = url.searchParams.get("orderId")?.trim() ?? "";
  const [order] = orderId
    ? await auth.db
        .select({ packageName: medtechPaymentOrders.packageName })
        .from(medtechPaymentOrders)
        .where(
          and(
            eq(medtechPaymentOrders.orderId, orderId),
            eq(medtechPaymentOrders.userKey, auth.userKey),
          ),
        )
        .limit(1)
    : [];
  if (orderId) {
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
  const destination = order?.packageName === "隨機模考" ? "/medtech/random" : "/medtech/chapters";
  return Response.redirect(`${url.origin}${destination}?payment=cancelled`);
}
