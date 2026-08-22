import { eq } from "drizzle-orm";
import { medtechProducts } from "../../../../../db/schema";
import { requireMedtechAdmin } from "../../../../../lib/member-auth";
import { getMedtechProductSettings, MEDTECH_DEFAULT_PRODUCT_KEY } from "../../../../../lib/medtech-product-settings";

const OWNER_EMAIL = "iamflashon@gmail.com";
const dateOrNull = (value: unknown) => typeof value === "string" && value ? new Date(value) : null;

export async function GET(request: Request) {
  const auth = await requireMedtechAdmin(request);
  if ("error" in auth) return auth.error;
  const product = await getMedtechProductSettings(auth.db);
  return Response.json({ product, canManageCommercial: auth.member.email === OWNER_EMAIL });
}

export async function PATCH(request: Request) {
  const auth = await requireMedtechAdmin(request);
  if ("error" in auth) return auth.error;
  if (auth.member.email !== OWNER_EMAIL) return Response.json({ error: "只有總管理者可修改價格、活動與開通天數" }, { status: 403 });
  const body = await request.json() as Record<string, unknown>;
  const listPrice = Math.max(1, Math.round(Number(body.listPrice)));
  const salePrice = body.salePrice === "" || body.salePrice === null ? null : Math.max(1, Math.round(Number(body.salePrice)));
  const accessDays = Math.max(1, Math.min(3650, Math.round(Number(body.accessDays))));
  const trialQuestions = Math.max(0, Math.min(1000, Math.round(Number(body.trialQuestions))));
  if (![listPrice, accessDays, trialQuestions].every(Number.isFinite) || (salePrice !== null && !Number.isFinite(salePrice))) return Response.json({ error: "價格、天數或免費題數格式不正確" }, { status: 400 });
  const [updated] = await auth.db.update(medtechProducts).set({
    listPrice, salePrice, accessDays, trialQuestions,
    saleLabel: typeof body.saleLabel === "string" ? body.saleLabel.trim().slice(0, 80) : "",
    saleStartsAt: dateOrNull(body.saleStartsAt), saleEndsAt: dateOrNull(body.saleEndsAt),
    status: body.status === "disabled" ? "disabled" : "active", updatedAt: new Date(),
  }).where(eq(medtechProducts.productKey, MEDTECH_DEFAULT_PRODUCT_KEY)).returning();
  return Response.json({ product: updated });
}
