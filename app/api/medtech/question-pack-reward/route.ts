import { and, eq } from "drizzle-orm";
import { medtechPracticeSessions } from "../../../../db/schema";
import { requireMedtechDevice } from "../../../../lib/member-auth";
import { createMedtechPackDiscountReward, getMedtechPackDiscountReward } from "../../../../lib/medtech-usage";

const allowedPackages = new Set(["臨床病毒學總論", "DNA 病毒", "RNA 病毒", "全真模擬試題", "隨機模考"]);

function readPackage(input: unknown) {
  const value = typeof input === "string" ? input.trim() : "";
  return allowedPackages.has(value) ? value : "隨機模考";
}

function readPackNumber(input: unknown) {
  const value = Math.floor(Number(input));
  return Number.isFinite(value) ? Math.max(1, Math.min(99, value)) : 1;
}

async function canSpinForPackage(auth: { db: Awaited<ReturnType<typeof import("../../../../db").getDb>>; userKey: string }, packageName: string, packageNumber: number) {
  const isCompleted = (row: { completedAt: Date | null; status: string }) => Boolean(row.completedAt || row.status === "completed");
  if (packageNumber > 1) {
    const previousRows = await auth.db.select({ completedAt: medtechPracticeSessions.completedAt, status: medtechPracticeSessions.status })
      .from(medtechPracticeSessions)
      .where(and(
        eq(medtechPracticeSessions.userKey, auth.userKey),
        eq(medtechPracticeSessions.packageName, packageName),
        eq(medtechPracticeSessions.packNumber, packageNumber - 1),
      ));
    if (!previousRows.some(isCompleted)) return false;
  }
  const completedRows = await auth.db.select({ completedAt: medtechPracticeSessions.completedAt, status: medtechPracticeSessions.status })
    .from(medtechPracticeSessions)
    .where(and(
      eq(medtechPracticeSessions.userKey, auth.userKey),
      eq(medtechPracticeSessions.packageName, packageName),
      eq(medtechPracticeSessions.packNumber, packageNumber),
    ));
  return packageNumber > 1 || completedRows.some(isCompleted);
}

export async function GET(request: Request) {
  const auth = await requireMedtechDevice(request);
  if ("error" in auth) return auth.error;
  const url = new URL(request.url);
  const packageName = readPackage(url.searchParams.get("packageName"));
  const packageNumber = readPackNumber(url.searchParams.get("pack"));
  const reward = await getMedtechPackDiscountReward(auth.db, auth.userKey, packageName, packageNumber);
  return Response.json({ packageName, packageNumber, reward });
}

export async function POST(request: Request) {
  const auth = await requireMedtechDevice(request);
  if ("error" in auth) return auth.error;
  let body: { packageName?: unknown; pack?: unknown; action?: unknown } = {};
  try {
    body = await request.json() as typeof body;
  } catch {
    return Response.json({ error: "轉轉樂資料格式錯誤。" }, { status: 400 });
  }
  const packageName = readPackage(body.packageName);
  const packageNumber = readPackNumber(body.pack);
  const action = body.action === "abandon" ? "abandon" : body.action === "spin" ? "spin" : "";
  if (!action) return Response.json({ error: "請選擇抽取折扣或放棄優惠。" }, { status: 400 });
  if (!(await canSpinForPackage(auth, packageName, packageNumber))) {
    return Response.json({ error: "完成上一關後，才可抽取這一關的折扣。" }, { status: 403 });
  }
  const reward = await createMedtechPackDiscountReward(auth.db, auth.userKey, packageName, packageNumber, action);
  return Response.json({ packageName, packageNumber, reward });
}
