import { eq } from "drizzle-orm";
import { aiPaymentOrders } from "../../../../../db/schema";
import { requireMember } from "../../../../../lib/member-auth";
export async function GET(request:Request){const auth=await requireMember(request),url=new URL(request.url),orderId=url.searchParams.get("orderId")?.trim()??"";if(!("error"in auth)&&orderId)await auth.db.update(aiPaymentOrders).set({status:"cancelled",updatedAt:new Date()}).where(eq(aiPaymentOrders.orderId,orderId));return Response.redirect(`${url.origin}/teachers/pengli/ai-access?ai_payment=cancelled`)}
