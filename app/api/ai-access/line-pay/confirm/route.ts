import { and, eq } from "drizzle-orm";
import { aiPaymentOrders } from "../../../../../db/schema";
import { grantOrExtendAiAccess } from "../../../../../lib/ai-access";
import { linePayPost } from "../../../../../lib/line-pay";
import { requireMember } from "../../../../../lib/member-auth";

export async function GET(request:Request){
  const auth=await requireMember(request);if("error"in auth)return auth.error;
  const url=new URL(request.url),orderId=url.searchParams.get("orderId")?.trim()??"",callbackTransactionId=url.searchParams.get("transactionId")?.trim()??"";
  const [order]=await auth.db.select().from(aiPaymentOrders).where(and(eq(aiPaymentOrders.orderId,orderId),eq(aiPaymentOrders.memberId,auth.member.id))).limit(1);
  const destination="/teachers/pengli/ai-access";
  if(!order)return Response.redirect(`${url.origin}${destination}?ai_payment=missing`);
  if(order.status==="paid")return Response.redirect(`${url.origin}${destination}?ai_payment=success`);
  const transactionId=callbackTransactionId||order.transactionId||"";
  if(!transactionId||(order.transactionId&&callbackTransactionId&&order.transactionId!==callbackTransactionId))return Response.redirect(`${url.origin}${destination}?ai_payment=invalid`);
  try{
    const result=await linePayPost(`/v3/payments/${transactionId}/confirm`,{amount:order.amount,currency:order.currency}),paid=result.returnCode==="0000";
    if(paid)await grantOrExtendAiAccess(auth.db,{memberId:auth.member.id,quota:order.quota,durationDays:order.durationDays,source:"line_pay",referenceId:order.orderId,note:`LINE Pay NT${order.amount} 單次付款／加購`});
    await auth.db.update(aiPaymentOrders).set({transactionId,status:paid?"paid":"failed",returnCode:result.returnCode??null,returnMessage:result.returnMessage??null,paidAt:paid?new Date():null,updatedAt:new Date()}).where(eq(aiPaymentOrders.id,order.id));
    return Response.redirect(`${url.origin}${destination}?ai_payment=${paid?"success":"failed"}`);
  }catch{return Response.redirect(`${url.origin}${destination}?ai_payment=failed`)}
}
