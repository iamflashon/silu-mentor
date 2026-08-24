import { eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { appSettings } from "../../../../db/schema";
import { requireAdmin } from "../../../../lib/member-auth";

const SETTINGS_KEY = "ai_access_admin_v1";
const categories = ["law", "accounting", "medtech", "data-structure"] as const;

type Policy = {
  enabled: boolean;
  name: string;
  price: number;
  quota: number;
  durationDays: number;
  coachRounds: number;
  autoRenew: false;
  categories: string[];
  notes: string;
};

type ActivationCode = {
  id: string;
  hash: string;
  last4: string;
  label: string;
  status: "unused" | "redeemed" | "disabled" | "expired";
  categories: string[];
  redeemBy: string | null;
  createdAt: string;
  redeemedAt: string | null;
  redeemedBy: string | null;
};

type Stored = { policy: Policy; codes: ActivationCode[]; updatedAt: string };

const defaultPolicy: Policy = {
  enabled: false,
  name: "AI 試問方案｜30 天 30 次",
  price: 30,
  quota: 30,
  durationDays: 30,
  coachRounds: 5,
  autoRenew: false,
  categories: [...categories],
  notes: "一般 AI 試問成功回答扣 1 次；AI 教練每 5 輪引導扣 1 次。系統錯誤、逾時、既有解析、教材搜尋及管理員測試不扣次數。",
};

function parse(value?: string): Stored {
  try {
    const stored = JSON.parse(value ?? "") as Stored;
    if (stored?.policy && Array.isArray(stored.codes)) return stored;
  } catch {}
  return { policy: defaultPolicy, codes: [], updatedAt: new Date(0).toISOString() };
}

async function save(db: Awaited<ReturnType<typeof getDb>>, stored: Stored) {
  const value = JSON.stringify(stored);
  await db.insert(appSettings).values({ key: SETTINGS_KEY, value, updatedAt: new Date() })
    .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: new Date() } });
}

async function digest(value: string) {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  return Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
}

function randomPart(length = 4) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, byte => alphabet[byte % alphabet.length]).join("");
}

function publicStored(stored: Stored) {
  return { ...stored, codes: stored.codes.map(({ hash: _hash, ...code }) => code) };
}

export async function GET(request: Request) {
  const auth = await requireAdmin(request);
  if ("error" in auth) return auth.error;
  const [row] = await auth.db.select().from(appSettings).where(eq(appSettings.key, SETTINGS_KEY)).limit(1);
  return Response.json(publicStored(parse(row?.value)), { headers: { "cache-control": "no-store" } });
}

export async function POST(request: Request) {
  const auth = await requireAdmin(request);
  if ("error" in auth) return auth.error;
  const body = await request.json() as Record<string, unknown>;
  const [row] = await auth.db.select().from(appSettings).where(eq(appSettings.key, SETTINGS_KEY)).limit(1);
  const stored = parse(row?.value);

  if (body.action === "save-policy") {
    const input = body.policy as Partial<Policy> | undefined;
    const selected = Array.isArray(input?.categories) ? input.categories.filter(item => categories.includes(item as typeof categories[number])) : [];
    stored.policy = {
      enabled: input?.enabled === true,
      name: String(input?.name ?? defaultPolicy.name).trim().slice(0, 80) || defaultPolicy.name,
      price: Math.max(1, Math.min(10000, Number(input?.price) || 30)),
      quota: Math.max(1, Math.min(1000, Number(input?.quota) || 30)),
      durationDays: Math.max(1, Math.min(365, Number(input?.durationDays) || 30)),
      coachRounds: Math.max(1, Math.min(20, Number(input?.coachRounds) || 5)),
      autoRenew: false,
      categories: selected.length ? selected : [...categories],
      notes: String(input?.notes ?? defaultPolicy.notes).trim().slice(0, 2000),
    };
    stored.updatedAt = new Date().toISOString();
    await save(auth.db, stored);
    return Response.json(publicStored(stored));
  }

  if (body.action === "generate-codes") {
    const count = Math.max(1, Math.min(100, Number(body.count) || 1));
    const label = String(body.label ?? "贈送方案").trim().slice(0, 80) || "贈送方案";
    const redeemBy = body.redeemBy ? String(body.redeemBy).slice(0, 10) : null;
    const selected = Array.isArray(body.categories) ? body.categories.filter(item => categories.includes(item as typeof categories[number])) : stored.policy.categories;
    const plaintext: string[] = [];
    for (let index = 0; index < count; index += 1) {
      const code = `IB-AI-${randomPart()}-${randomPart()}`;
      plaintext.push(code);
      stored.codes.unshift({ id: crypto.randomUUID(), hash: await digest(code), last4: code.slice(-4), label, status: "unused", categories: selected, redeemBy, createdAt: new Date().toISOString(), redeemedAt: null, redeemedBy: null });
    }
    stored.codes = stored.codes.slice(0, 1000);
    stored.updatedAt = new Date().toISOString();
    await save(auth.db, stored);
    return Response.json({ ...publicStored(stored), generatedCodes: plaintext });
  }

  if (body.action === "disable-code") {
    const code = stored.codes.find(item => item.id === body.id);
    if (!code || code.status !== "unused") return Response.json({ error: "只有尚未使用的啟用碼可以停用" }, { status: 409 });
    code.status = "disabled";
    stored.updatedAt = new Date().toISOString();
    await save(auth.db, stored);
    return Response.json(publicStored(stored));
  }

  return Response.json({ error: "不支援的操作" }, { status: 400 });
}
