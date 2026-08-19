import { and, eq } from "drizzle-orm";
import { getDb } from "../db";
import { memberExamAccess, members } from "../db/schema";
import { getOrCreateMedtechUsage } from "./medtech-usage";
import { getMedtechDeviceStatus } from "./medtech-device-session";
import { ADMIN_ENTRY_OWNER_EMAIL, isAdminEntryAuthenticated } from "./admin-entry-auth";

export type MemberRole = "teacher" | "student";

const OWNER_EMAIL = "iamflashon@gmail.com";

function decodeName(request: Request) {
  const encoded = request.headers.get("oai-authenticated-user-full-name");
  if (!encoded || request.headers.get("oai-authenticated-user-full-name-encoding") !== "percent-encoded-utf-8") return "";
  try { return decodeURIComponent(encoded); } catch { return ""; }
}

export function authenticatedEmail(request: Request) {
  return request.headers.get("oai-authenticated-user-email")?.trim().toLowerCase() ?? "";
}

export async function requireMember(request: Request) {
  const email = authenticatedEmail(request) || (await isAdminEntryAuthenticated(request) ? ADMIN_ENTRY_OWNER_EMAIL : "");
  if (!email) return { error: Response.json({ error: "請先登入自己的學習帳號" }, { status: 401 }) } as const;
  const db = await getDb();
  let [member] = await db.select().from(members).where(eq(members.email, email)).limit(1);
  if (!member) {
    [member] = await db.insert(members).values({
      email,
      displayName: decodeName(request) || email.split("@")[0],
      role: "student",
      canAdmin: email === OWNER_EMAIL,
      status: "active",
      lastSeenAt: new Date(),
    }).returning();
  } else {
    const ownerNeedsRepair = email === OWNER_EMAIL && (!member.canAdmin || member.role === "admin");
    const legacyAdminNeedsRepair = member.role === "admin";
    const patch = {
      lastSeenAt: new Date(),
      updatedAt: new Date(),
      ...(ownerNeedsRepair || legacyAdminNeedsRepair ? { canAdmin: true, role: "student" } : {}),
    };
    await db.update(members).set(patch).where(eq(members.id, member.id));
    member = { ...member, ...patch };
  }
  if (member.status !== "active") return { error: Response.json({ error: "此帳號目前已停用，請聯絡管理員" }, { status: 403 }) } as const;
  return { member, userKey: member.email, db } as const;
}

export async function requireAdmin(request: Request) {
  const auth = await requireMember(request);
  if ("error" in auth) return auth;
  if (!auth.member.canAdmin) return { error: Response.json({ error: "需要管理員權限" }, { status: 403 }) } as const;
  return auth;
}

export async function requireMedtechMember(request: Request) {
  const auth = await requireMember(request);
  if ("error" in auth) return auth;
  let [access] = await auth.db.select().from(memberExamAccess).where(and(eq(memberExamAccess.memberId, auth.member.id), eq(memberExamAccess.examCategory, "medtech"))).limit(1);
  if (!access) {
    await auth.db.insert(memberExamAccess).values({
      memberId: auth.member.id,
      examCategory: "medtech",
      status: "active",
      canAdmin: auth.member.email === OWNER_EMAIL,
      className: auth.member.email === OWNER_EMAIL ? "管理員" : auth.member.className || "未分班",
    }).onConflictDoNothing();
    [access] = await auth.db.select().from(memberExamAccess).where(and(eq(memberExamAccess.memberId, auth.member.id), eq(memberExamAccess.examCategory, "medtech"))).limit(1);
  }
  if (!access || access.status !== "active") return { error: Response.json({ error: "此帳號尚未開通醫檢師類科" }, { status: 403 }) } as const;
  await getOrCreateMedtechUsage(auth.db, auth.member.email);
  return { ...auth, access } as const;
}

export async function requireMedtechDevice(request: Request) {
  const auth = await requireMedtechMember(request);
  if ("error" in auth) return auth;
  const device = await getMedtechDeviceStatus(auth.db, auth.userKey, request, new URL(request.url).pathname);
  if (device.blocked) {
    return {
      error: Response.json({
        error: "此帳號目前已在 2 台裝置使用。請先登出其中一台，或選擇由系統踢出一台，再繼續使用。",
        code: "DEVICE_LIMIT",
        maxDevices: device.maxDevices,
        sessions: device.sessions.map((session) => ({ id: session.id, deviceLabel: session.deviceLabel, firstSeenAt: session.firstSeenAt, lastSeenAt: session.lastSeenAt })),
        anomaly: device.anomaly,
      }, { status: 409 }),
    } as const;
  }
  return { ...auth, device } as const;
}

export async function requireMedtechAdmin(request: Request) {
  const auth = await requireMedtechMember(request);
  if ("error" in auth) return auth;
  if (!auth.access.canAdmin) return { error: Response.json({ error: "需要醫檢師管理權限" }, { status: 403 }) } as const;
  return auth;
}

export async function requireAccountingMember(request: Request) {
  const auth = await requireMember(request);
  if ("error" in auth) return auth;
  let [access] = await auth.db.select().from(memberExamAccess).where(and(eq(memberExamAccess.memberId, auth.member.id), eq(memberExamAccess.examCategory, "accounting"))).limit(1);
  if (!access && auth.member.email === OWNER_EMAIL) {
    [access] = await auth.db.insert(memberExamAccess).values({ memberId: auth.member.id, examCategory: "accounting", status: "active", canAdmin: true, className: "管理員" }).returning();
  }
  if (!access || access.status !== "active") return { error: Response.json({ error: "此帳號尚未開通中級會計類科" }, { status: 403 }) } as const;
  return { ...auth, access } as const;
}

export async function requireAccountingAdmin(request: Request) {
  const auth = await requireAccountingMember(request);
  if ("error" in auth) return auth;
  if (!auth.access.canAdmin) return { error: Response.json({ error: "需要中級會計管理權限" }, { status: 403 }) } as const;
  return auth;
}
