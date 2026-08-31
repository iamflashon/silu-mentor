import { eq } from "drizzle-orm";
import { appSettings, medtechProducts } from "../../../../../db/schema";
import { requireMedtechAdmin } from "../../../../../lib/member-auth";
import { getMedtechProductSettings, MEDTECH_DEFAULT_PRODUCT_KEY, MEDTECH_DESCRIPTION_SETTING_KEY } from "../../../../../lib/medtech-product-settings";

const OWNER_EMAIL = "iamflashon@gmail.com";
const isOwner = (email: string) => email.trim().toLowerCase() === OWNER_EMAIL;

function parseDate(value: unknown, label: string) {
  if (value === null || value === "" || typeof value === "undefined") return { value: null as Date | null };
  if (typeof value !== "string") return { error: `${label}格式不正確` };
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? { error: `${label}格式不正確` } : { value: parsed };
}

function parseInteger(value: unknown, label: string, min: number, max: number) {
  if (value === "" || value === null || typeof value === "undefined") return { error: `請填寫${label}` };
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) return { error: `${label}格式不正確` };
  return { value: Math.min(max, Math.max(min, parsed)) };
}

export async function GET(request: Request) {
  const auth = await requireMedtechAdmin(request);
  if ("error" in auth) return auth.error;
  const product = await getMedtechProductSettings(auth.db);
  return Response.json({ product, canManageCommercial: isOwner(auth.member.email) }, { headers: { "cache-control": "no-store" } });
}

export async function PATCH(request: Request) {
  const auth = await requireMedtechAdmin(request);
  if ("error" in auth) return auth.error;
  if (!isOwner(auth.member.email)) return Response.json({ error: "只有總管理者可修改價格、活動與開通天數" }, { status: 403 });

  try {
    const body = await request.json() as Record<string, unknown>;
    const listPrice = parseInteger(body.listPrice, "定價", 1, 1000000);
    const accessDays = parseInteger(body.accessDays, "開通天數", 1, 3650);
    const trialQuestions = parseInteger(body.trialQuestions, "免費體驗題數", 0, 1000);
    const salePrice = body.salePrice === "" || body.salePrice === null || typeof body.salePrice === "undefined"
      ? { value: null as number | null }
      : parseInteger(body.salePrice, "活動價", 1, 1000000);
    const saleStartsAt = parseDate(body.saleStartsAt, "活動開始");
    const saleEndsAt = parseDate(body.saleEndsAt, "活動結束");
    const invalid = [listPrice, accessDays, trialQuestions, salePrice, saleStartsAt, saleEndsAt].find((item) => "error" in item);
    if (invalid && "error" in invalid) return Response.json({ error: invalid.error }, { status: 400 });
    if (saleStartsAt.value && saleEndsAt.value && saleStartsAt.value > saleEndsAt.value) {
      return Response.json({ error: "活動結束時間必須晚於開始時間" }, { status: 400 });
    }

    // The settings row is lazily created for older databases. Ensure it exists
    // before updating, otherwise D1 can return a successful empty update.
    await getMedtechProductSettings(auth.db);
    const [updated] = await auth.db.update(medtechProducts).set({
      listPrice: listPrice.value,
      salePrice: salePrice.value,
      accessDays: accessDays.value,
      trialQuestions: trialQuestions.value,
      saleLabel: typeof body.saleLabel === "string" ? body.saleLabel.trim().slice(0, 80) : "",
      saleStartsAt: saleStartsAt.value,
      saleEndsAt: saleEndsAt.value,
      status: body.status === "disabled" ? "disabled" : "active",
      updatedAt: new Date(),
    }).where(eq(medtechProducts.productKey, MEDTECH_DEFAULT_PRODUCT_KEY)).returning();
    if (!updated) return Response.json({ error: "找不到商品設定，請重新整理後再試。" }, { status: 404 });
    await auth.db.insert(appSettings).values({
      key: MEDTECH_DESCRIPTION_SETTING_KEY,
      value: typeof body.descriptionHtml === "string" ? body.descriptionHtml.slice(0, 50000) : "",
      updatedAt: new Date(),
    }).onConflictDoUpdate({
      target: appSettings.key,
      set: {
        value: typeof body.descriptionHtml === "string" ? body.descriptionHtml.slice(0, 50000) : "",
        updatedAt: new Date(),
      },
    });
    const product = await getMedtechProductSettings(auth.db);
    return Response.json({ product }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    console.error("[medtech] product settings update failed", error);
    return Response.json({ error: "商品設定儲存失敗，請重新整理後再試。" }, { status: 500 });
  }
}
