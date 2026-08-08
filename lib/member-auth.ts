import { eq } from "drizzle-orm";
import { getDb } from "../db";
import { members } from "../db/schema";

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
  const email = authenticatedEmail(request);
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
