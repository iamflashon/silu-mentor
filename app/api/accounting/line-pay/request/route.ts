import { eq } from "drizzle-orm";
import { medtechPaymentOrders } from "../../../../../db/schema";
import { requireMember } from "../../../../../lib/member-auth";
import { linePayConfig, linePayPost } from "../../../../../lib/line-pay";
import {
  getAccountingProductSettings,
  ACCOUNTING_FIRST_PRODUCT_KEY,
} from "../../../../../lib/accounting-product-settings";
import {
  ACCOUNTING_AI_DAYS,
  ACCOUNTING_AI_PRICE,
  ACCOUNTING_AI_QUOTA,
} from "../../../../../lib/accounting-ai-access";

export async function POST(request: Request) {
  const auth = await requireMember(request);
  if ("error" in auth) return auth.error;
  const body = (await request.json().catch(() => ({}))) as {
    plan?: string;
    chapterNumber?: number;
  };
  const product = await getAccountingProductSettings(auth.db);
  if (product.status !== "active")
    return Response.json({ error: "此教材目前暫停銷售" }, { status: 409 });
  try {
    const config = await linePayConfig();
    if (!config.channelId || !config.channelSecret)
      return Response.json({ error: "LINE Pay 尚未設定" }, { status: 503 });
    const chapterNumber = Math.max(
      1,
      Math.min(18, Math.floor(Number(body.chapterNumber || 1))),
    );
    const aiPlan = body.plan === "ai";
    const chapterPlan = body.plan === "chapter";
    const amount = aiPlan
      ? ACCOUNTING_AI_PRICE
      : chapterPlan
        ? 39
        : product.effectivePrice;
    const accessDays = aiPlan
      ? ACCOUNTING_AI_DAYS
      : chapterPlan
        ? 30
        : product.accessDays;
    const packageName = aiPlan
      ? "accounting:ai"
      : chapterPlan
        ? `accounting:chapter:${chapterNumber}`
        : `accounting:${ACCOUNTING_FIRST_PRODUCT_KEY}`;
    const orderId = `AC${Date.now()}${crypto.randomUUID().replaceAll("-", "").slice(0, 10)}`;
    const origin = new URL(request.url).origin;
    await auth.db
      .insert(medtechPaymentOrders)
      .values({
        userKey: auth.userKey,
        orderId,
        environment: config.environment,
        packageName,
        packNumber: chapterPlan ? chapterNumber : 1,
        amount,
        currency: "TWD",
        status: "pending",
      });
    const result = await linePayPost("/v3/payments/request", {
      amount,
      currency: "TWD",
      orderId,
      packages: [
        {
          id: packageName,
          amount,
          products: [
            {
              id: packageName,
              name: aiPlan
                ? `中會課業答疑 ${ACCOUNTING_AI_QUOTA} 次／${accessDays} 天`
                : chapterPlan
                  ? `${product.title}・第 ${chapterNumber} 章 ${accessDays} 天`
                  : `${product.title}・整本 ${accessDays} 天`,
              quantity: 1,
              price: amount,
            },
          ],
        },
      ],
      redirectUrls: {
        confirmUrl: `${origin}/api/accounting/line-pay/confirm?orderId=${encodeURIComponent(orderId)}`,
        cancelUrl: `${origin}/api/accounting/line-pay/cancel?orderId=${encodeURIComponent(orderId)}`,
      },
    });
    const transactionId = String(result.info?.transactionId ?? "");
    const paymentUrl = String(
      (result.info?.paymentUrl as { web?: unknown } | undefined)?.web ?? "",
    );
    await auth.db
      .update(medtechPaymentOrders)
      .set({
        transactionId: transactionId || null,
        returnCode: result.returnCode ?? null,
        returnMessage: result.returnMessage ?? null,
        status:
          result.returnCode === "0000" && paymentUrl ? "authorized" : "failed",
        updatedAt: new Date(),
      })
      .where(eq(medtechPaymentOrders.orderId, orderId));
    if (result.returnCode !== "0000" || !paymentUrl)
      return Response.json(
        {
          error: `LINE Pay 建立付款失敗：${result.returnMessage || result.returnCode || "未知錯誤"}`,
        },
        { status: 502 },
      );
    return Response.json({ paymentUrl, orderId });
  } catch {
    return Response.json({ error: "LINE Pay 付款建立失敗" }, { status: 500 });
  }
}
