import { eq } from "drizzle-orm";
import { medtechPaymentOrders } from "../../../../../db/schema";
import { requireMedtechMember } from "../../../../../lib/member-auth";
import { linePayConfig, linePayPost } from "../../../../../lib/line-pay";
import {
  MEDTECH_ALL_ACCESS_NAME,
} from "../../../../../lib/medtech-usage";
import { getMedtechProductSettings } from "../../../../../lib/medtech-product-settings";

const allowedPackages = new Set([
  MEDTECH_ALL_ACCESS_NAME,
]);

export async function POST(request: Request) {
  const auth = await requireMedtechMember(request);
  if ("error" in auth) return auth.error;
  try {
    const body = (await request.json()) as {
      packageName?: string;
      packNumber?: number;
    };
    const packageName = String(body.packageName ?? "").trim();
    const packNumber = Math.max(1, Math.floor(Number(body.packNumber)));
    if (!allowedPackages.has(packageName) || !Number.isInteger(packNumber)) {
      return Response.json({ error: "題目包資料不正確" }, { status: 400 });
    }

    if (packageName !== MEDTECH_ALL_ACCESS_NAME) {
      return Response.json({ error: "單包購買已停止，請改用全庫通行證" }, { status: 400 });
    }
    const product = await getMedtechProductSettings(auth.db);
    if (product.status !== "active") return Response.json({ error: "此方案目前暫停銷售" }, { status: 409 });
    const packagePrice = product.effectivePrice;
    const config = await linePayConfig();
    if (!config.channelId || !config.channelSecret) {
      return Response.json(
        { error: "此網站尚未設定 LINE Pay Channel ID／Secret" },
        { status: 503 },
      );
    }

    const orderId = `MT${Date.now()}${crypto.randomUUID().replaceAll("-", "").slice(0, 10)}`;
    const origin = new URL(request.url).origin;
    await auth.db.insert(medtechPaymentOrders).values({
      userKey: auth.userKey,
      orderId,
      environment: config.environment,
      packageName,
      packNumber,
      amount: packagePrice,
      currency: "TWD",
      status: "pending",
    });

    const result = await linePayPost("/v3/payments/request", {
      amount: packagePrice,
      currency: "TWD",
      orderId,
      packages: [
        {
          id: `${packageName}-${packNumber}`,
          amount: packagePrice,
          products: [
            {
              id: `medtech-${packNumber}`,
              name: packageName === MEDTECH_ALL_ACCESS_NAME
                ? `醫檢師備考｜${MEDTECH_ALL_ACCESS_NAME} ${product.accessDays} 天`
                : `醫檢師題目包｜${packageName}第 ${packNumber} 關`,
              quantity: 1,
              price: packagePrice,
            },
          ],
        },
      ],
      redirectUrls: {
        confirmUrl: `${origin}/api/medtech/line-pay/confirm?orderId=${encodeURIComponent(orderId)}`,
        cancelUrl: `${origin}/api/medtech/line-pay/cancel?orderId=${encodeURIComponent(orderId)}`,
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
    if (result.returnCode !== "0000" || !paymentUrl) {
      const invalidChannel = /X-LINE-ChannelId|Channel\s*ID/i.test(
        result.returnMessage ?? "",
      );
      return Response.json(
        {
          error: invalidChannel
            ? "LINE Pay Channel ID 無效；請確認使用 LINE Pay Sandbox 核發且與 Secret 配對的 Channel ID"
            : `LINE Pay 建立付款失敗：${result.returnMessage || result.returnCode || "未知錯誤"}`,
        },
        { status: 502 },
      );
    }
    return Response.json({
      paymentUrl,
      orderId,
      environment: config.environment,
    });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error && error.message === "LINE_PAY_NOT_CONFIGURED"
            ? "LINE Pay 尚未設定"
            : "LINE Pay 付款建立失敗",
      },
      { status: 500 },
    );
  }
}
