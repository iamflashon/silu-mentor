import { getDb } from "../../../../db";
import { getMedtechProductSettings } from "../../../../lib/medtech-product-settings";
import { requireMedtechMember } from "../../../../lib/member-auth";
import { getActiveMedtechAllAccess } from "../../../../lib/medtech-usage";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: Request) {
  try {
    const db = await getDb();
    const product = await getMedtechProductSettings(db);
    const auth = await requireMedtechMember(request);
    const entitlement = "error" in auth
      ? null
      : await getActiveMedtechAllAccess(auth.db, auth.userKey);
    return Response.json(
      {
        product: {
          title: product.title,
          effectivePrice: product.effectivePrice,
          accessDays: product.accessDays,
          trialQuestions: product.trialQuestions,
          saleActive: product.saleActive,
          saleLabel: product.saleLabel,
          entitlement: entitlement
            ? {
                purchased: true,
                startedAt: entitlement.startedAt.toISOString(),
                availableUntil: entitlement.availableUntil.toISOString(),
              }
            : null,
        },
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    console.error("medtech.product.get.failed", error);
    return Response.json({ error: "方案設定讀取失敗" }, { status: 503 });
  }
}
