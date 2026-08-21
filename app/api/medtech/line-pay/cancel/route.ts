import { and, eq } from "drizzle-orm";
import { medtechPaymentOrders } from "../../../../../db/schema";
import { requireMedtechMember } from "../../../../../lib/member-auth";

export async function GET(request: Request) {
  const auth = await requireMedtechMember(request);
  if ("error" in auth) return auth.error;
  const url = new URL(request.url);
  const orderId = url.searchParams.get("orderId")?.trim() ?? "";
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
  return Response.redirect(`${url.origin}/medtech/chapters?payment=cancelled`);
}
