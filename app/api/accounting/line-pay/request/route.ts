import { eq } from "drizzle-orm";
import { medtechPaymentOrders } from "../../../../../db/schema";
import { requireMember } from "../../../../../lib/member-auth";
import { linePayConfig, linePayPost } from "../../../../../lib/line-pay";
import { getAccountingProductSettings, ACCOUNTING_FIRST_PRODUCT_KEY } from "../../../../../lib/accounting-product-settings";

export async function POST(request: Request) {
  const auth = await requireMember(request); if ("error" in auth) return auth.error;
  const product = await getAccountingProductSettings(auth.db);
  if (product.status !== "active") return Response.json({ error: "此教材目前暫停銷售" }, { status: 409 });
  try {
    const config = await linePayConfig();
    if (!config.channelId || !config.channelSecret) return Response.json({ error: "LINE Pay 尚未設定" }, { status: 503 });
    const orderId = `AC${Date.now()}${crypto.randomUUID().replaceAll("-", "").slice(0, 10)}`;
    const origin = new URL(request.url).origin;
    await auth.db.insert(medtechPaymentOrders).values({ userKey: auth.userKey, orderId, environment: config.environment, packageName: `accounting:${ACCOUNTING_FIRST_PRODUCT_KEY}`, packNumber: 1, amount: product.effectivePrice, currency: "TWD", status: "pending" });
    const result = await linePayPost("/v3/payments/request", { amount: product.effectivePrice, currency: "TWD", orderId, packages: [{ id: ACCOUNTING_FIRST_PRODUCT_KEY, amount: product.effectivePrice, products: [{ id: ACCOUNTING_FIRST_PRODUCT_KEY, name: `${product.title} ${product.accessDays} 天`, quantity: 1, price: product.effectivePrice }] }], redirectUrls: { confirmUrl: `${origin}/api/accounting/line-pay/confirm?orderId=${encodeURIComponent(orderId)}`, cancelUrl: `${origin}/api/accounting/line-pay/cancel?orderId=${encodeURIComponent(orderId)}` } });
    const transactionId = String(result.info?.transactionId ?? ""); const paymentUrl = String((result.info?.paymentUrl as { web?: unknown } | undefined)?.web ?? "");
    await auth.db.update(medtechPaymentOrders).set({ transactionId: transactionId || null, returnCode: result.returnCode ?? null, returnMessage: result.returnMessage ?? null, status: result.returnCode === "0000" && paymentUrl ? "authorized" : "failed", updatedAt: new Date() }).where(eq(medtechPaymentOrders.orderId, orderId));
    if (result.returnCode !== "0000" || !paymentUrl) return Response.json({ error: `LINE Pay 建立付款失敗：${result.returnMessage || result.returnCode || "未知錯誤"}` }, { status: 502 });
    return Response.json({ paymentUrl, orderId });
  } catch { return Response.json({ error: "LINE Pay 付款建立失敗" }, { status: 500 }); }
}
