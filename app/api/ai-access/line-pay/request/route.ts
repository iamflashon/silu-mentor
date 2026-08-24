import { eq } from "drizzle-orm";
import { aiPaymentOrders } from "../../../../../db/schema";
import { getActiveAiEntitlement, getAiPlan } from "../../../../../lib/ai-access";
import { linePayConfig, linePayPost } from "../../../../../lib/line-pay";
import { requireMember } from "../../../../../lib/member-auth";

export async function POST(request:Request) {
  const auth = await requireMember(request);
  if ("error" in auth) return auth.error;
  if (await getActiveAiEntitlement(auth.db, auth.member.id)) return Response.json({ error:"目前仍有有效的 AI 方案，請於額度用完或到期後再購買" }, { status:409 });
  const plan = await getAiPlan(auth.db);
  if (!plan.enabled) return Response.json({ error:"AI 試問方案目前尚未開放購買" }, { status:409 });
  const config = await linePayConfig();
  if (!config.channelId || !config.channelSecret) return Response.json({ error:"網站尚未設定 LINE Pay" }, { status:503 });
  const orderId = `AI${Date.now()}${crypto.randomUUID().replaceAll("-", "").slice(0,10)}`;
  const origin = new URL(request.url).origin;
  await auth.db.insert(aiPaymentOrders).values({ memberId:auth.member.id, orderId, environment:config.environment, amount:plan.price, currency:"TWD", quota:plan.quota, durationDays:plan.durationDays, status:"pending" });
  try {
    const result = await linePayPost("/v3/payments/request", { amount:plan.price, currency:"TWD", orderId, packages:[{ id:"ai-access", amount:plan.price, products:[{ id:"ai-access-30", name:plan.name, quantity:1, price:plan.price }] }], redirectUrls:{ confirmUrl:`${origin}/api/ai-access/line-pay/confirm?orderId=${encodeURIComponent(orderId)}`, cancelUrl:`${origin}/api/ai-access/line-pay/cancel?orderId=${encodeURIComponent(orderId)}` } });
    const transactionId = String(result.info?.transactionId ?? "");
    const paymentUrl = String((result.info?.paymentUrl as { web?:unknown } | undefined)?.web ?? "");
    await auth.db.update(aiPaymentOrders).set({ transactionId:transactionId || null, returnCode:result.returnCode ?? null, returnMessage:result.returnMessage ?? null, status:result.returnCode === "0000" && paymentUrl ? "authorized" : "failed", updatedAt:new Date() }).where(eq(aiPaymentOrders.orderId,orderId));
    if (result.returnCode !== "0000" || !paymentUrl) return Response.json({ error:`LINE Pay 建立付款失敗：${result.returnMessage || result.returnCode || "未知錯誤"}` }, { status:502 });
    return Response.json({ paymentUrl, orderId, environment:config.environment });
  } catch {
    await auth.db.update(aiPaymentOrders).set({ status:"failed", updatedAt:new Date() }).where(eq(aiPaymentOrders.orderId,orderId));
    return Response.json({ error:"LINE Pay 付款建立失敗" }, { status:500 });
  }
}
