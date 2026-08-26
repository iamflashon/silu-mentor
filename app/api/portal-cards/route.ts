import { eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { appSettings } from "../../../db/schema";
import { requireAdmin } from "../../../lib/member-auth";

const SETTING_KEY = "portal_exam_cards";

export type PortalExamCard = {
  id: "law" | "pengli" | "medtech" | "accounting";
  enabled: boolean;
  order: number;
};

const defaults: PortalExamCard[] = [
  { id: "pengli", enabled: true, order: 1 },
  { id: "medtech", enabled: true, order: 2 },
  { id: "accounting", enabled: true, order: 3 },
  { id: "law", enabled: false, order: 4 },
];

function normalize(value: unknown): PortalExamCard[] {
  const rows = Array.isArray(value) ? value : [];
  return defaults.map((fallback) => {
    const row = rows.find((item) => item && typeof item === "object" && (item as { id?: unknown }).id === fallback.id) as Partial<PortalExamCard> | undefined;
    return {
      id: fallback.id,
      enabled: row?.enabled !== false,
      order: Number.isFinite(Number(row?.order)) ? Number(row?.order) : fallback.order,
    };
  }).sort((a, b) => a.order - b.order).map((card, index) => ({ ...card, order: index + 1 }));
}

async function readCards() {
  const db = await getDb();
  const [row] = await db.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, SETTING_KEY)).limit(1);
  try { return normalize(row?.value ? JSON.parse(row.value) : defaults); } catch { return defaults; }
}

export async function GET() {
  return Response.json({ cards: await readCards() }, { headers: { "cache-control": "no-store" } });
}

export async function PATCH(request: Request) {
  const auth = await requireAdmin(request);
  if ("error" in auth) return auth.error;
  const body = await request.json() as { cards?: unknown };
  const cards = normalize(body.cards);
  const db = await getDb();
  await db.insert(appSettings).values({ key: SETTING_KEY, value: JSON.stringify(cards), updatedAt: new Date() })
    .onConflictDoUpdate({ target: appSettings.key, set: { value: JSON.stringify(cards), updatedAt: new Date() } });
  return Response.json({ cards, message: "首頁卡片設定已儲存" });
}
