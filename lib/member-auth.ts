import { eq, sql } from "drizzle-orm";
import { getDb } from "../db";
import { members } from "../db/schema";

export type MemberRole = "admin" | "teacher" | "student";

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
    const [{ count }] = await db.select({ count: sql<number>`count(*)` }).from(members);
    [member] = await db.insert(members).values({
      email,
      displayName: decodeName(request) || email.split("@")[0],
      role: Number(count) === 0 ? "admin" : "student",
      status: "active",
      lastSeenAt: new Date(),
    }).returning();
  } else {
    await db.update(members).set({ lastSeenAt: new Date(), updatedAt: new Date() }).where(eq(members.id, member.id));
  }
  if (member.status !== "active") return { error: Response.json({ error: "此帳號目前已停用，請聯絡管理員" }, { status: 403 }) } as const;
  return { member, userKey: member.email, db } as const;
}

export async function requireAdmin(request: Request) {
  const auth = await requireMember(request);
  if ("error" in auth) return auth;
  if (auth.member.role !== "admin") return { error: Response.json({ error: "需要管理員權限" }, { status: 403 }) } as const;
  return auth;
}
