import { getDb } from "../../../../db";
import { getMedtechProductSettings } from "../../../../lib/medtech-product-settings";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  try {
    const product = await getMedtechProductSettings(await getDb());
    return Response.json({
      product: {
        title: product.title,
        effectivePrice: product.effectivePrice,
        accessDays: product.accessDays,
        trialQuestions: product.trialQuestions,
        saleActive: product.saleActive,
        saleLabel: product.saleLabel,
      },
    }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    console.error("medtech.product.get.failed", error);
    return Response.json({ error: "方案設定讀取失敗" }, { status: 503 });
  }
}