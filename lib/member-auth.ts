import { and, eq } from "drizzle-orm";
import { getDb } from "../db";
import { memberExamAccess, members } from "../db/schema";
import { getOrCreateMedtechUsage } from "./medtech-usage";
import { getMedtechDeviceStatus } from "./medtech-device-session";

export type MemberRole = "teacher" | "student";

const OWNER_EMAIL = "iamflashon@gmail.com";

function accessJwtFromCookie(request: Request) {
  const cookie = request.headers.get("cookie") ?? "";
  const match = cookie.match(/(?:^|;\s*)CF_Authorization=([^;]+)/i);
  return match ? decodeURIComponent(match[1]) : "";
}

function emailFromAccessJwt(token: string) {
  try {
    const payload = token.split(".")[1];
    if (!payload) return "";
    const normalized = payload.replaceAll("-", "+").replaceAll("_", "/");
    const decoded = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "="));
    const claims = JSON.parse(decoded) as { email?: unknown };
    return typeof claims.email === "string" ? claims.email.trim().toLowerCase() : "";
  } catch {
    return "";
  }
}

export function authenticatedEmail(request: Request) {
  const sitesEmail = request.headers
    .get("oai-authenticated-user-email")
    ?.trim()
    .toLowerCase();
  if (sitesEmail) return sitesEmail;

  const accessEmail = request.headers
    .get("cf-access-authenticated-user-email")
    ?.trim()
    .toLowerCase();
  const accessJwt = request.headers.get("cf-access-jwt-assertion") || accessJwtFromCookie(request);
  if (!accessJwt) return "";
  // Access validates the assertion before this request reaches the Worker.
  // Browser API fetches may retain only the CF_Authorization cookie.
  return accessEmail || emailFromAccessJwt(accessJwt);
}

export async function requireMember(request: Request) {
  // ChatGPT is the sole identity provider. Never trust an app-owned session,
  // caller-supplied member id, or legacy administrator cookie here.
  const email = authenticatedEmail(request);
  if (!email) return { error: Response.json({ error: "請使用 ChatGPT 帳號登入" }, { status: 401 }) } as const;
  const db = await getDb();
  let [member] = await db.select().from(members).where(eq(members.email, email)).limit(1);
  if (!member) {
    // ChatGPT authentication proves identity, not platform membership.
    return { error: Response.json({
      error: "此 ChatGPT 帳號尚未由平台開通，請聯絡管理員。",
      code: "MEMBER_NOT_PROVISIONED",
    }, { status: 403 }) } as const;
  } else {
    const ownerNeedsRepair = email === OWNER_EMAIL && (!member.canAdmin || member.role === "admin");
    const legacyAdminNeedsRepair = member.role === "admin";
    const patch = {
      lastSeenAt: new Date(),
      updatedAt: new Date(),
      // Google-only accounts do not use this value for sign-in. Keep a private,
      // random server-side secret so short-lived purchase authorizations can be
      // signed without introducing another environment secret.
      ...(!member.passwordHash ? { passwordHash: `google$${crypto.randomUUID()}${crypto.randomUUID()}` } : {}),
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
  if (!("access" in auth)) return auth;
  if (!auth.access.canAdmin) return { error: Response.json({ error: "需要醫檢師管理權限" }, { status: 403 }) } as const;
  return auth;
}

export function hasMedtechPermission(permissionsJson: string, permission: string) {
  try {
    const permissions = JSON.parse(permissionsJson || "[]") as unknown;
    return Array.isArray(permissions) && permissions.includes(permission);
  } catch {
    return false;
  }
}

export async function requireMedtechBackoffice(request: Request) {
  const auth = await requireMedtechMember(request);
  if (!("access" in auth)) return auth;
  if (!auth.access.canAdmin && !hasMedtechPermission(auth.access.permissionsJson, "questions")) {
    return { error: Response.json({ error: "需要醫檢師後台權限" }, { status: 403 }) } as const;
  }
  return auth;
}

export async function requireMedtechQuestionEditor(request: Request) {
  const auth = await requireMedtechMember(request);
  if (!("access" in auth)) return auth;
  if (!auth.access.canAdmin && !hasMedtechPermission(auth.access.permissionsJson, "questions")) {
    return { error: Response.json({ error: "需要文件題庫編修權限" }, { status: 403 }) } as const;
  }
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
  if (!("access" in auth)) return auth;
  if (!auth.access.canAdmin) return { error: Response.json({ error: "需要中級會計管理權限" }, { status: 403 }) } as const;
  return auth;
}
