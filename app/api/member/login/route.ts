import { eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { members } from "../../../../db/schema";
import { safeReturnTo } from "../../../../lib/admin-entry-auth";
import { createMemberSessionCookie, verifyMemberPassword } from "../../../../lib/member-session-auth";

export async function POST(request: Request) {
  let body: { email?: unknown; password?: unknown; returnTo?: unknown } = {};
  try { body = await request.json(); } catch { /* handled as an invalid login below */ }
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!email || !password) return Response.json({ error: "請輸入會員帳號與密碼。" }, { status: 400 });
  try {
    const db = await getDb();
    const [member] = await db.select().from(members).where(eq(members.email, email)).limit(1);
    if (!member || member.status !== "active" || !member.passwordHash || !(await verifyMemberPassword(password, member.passwordHash))) {
      return Response.json({ error: "會員帳號或密碼錯誤，或帳號目前已停用。" }, { status: 401 });
    }
    const cookie = await createMemberSessionCookie({ memberId: member.id, email: member.email });
    if (!cookie) return Response.json({ error: "會員登入服務尚未完成設定。" }, { status: 503 });
    await db.update(members).set({ lastSeenAt: new Date(), updatedAt: new Date() }).where(eq(members.id, member.id));
    return Response.json({ ok: true, returnTo: safeReturnTo(body.returnTo) }, { headers: { "cache-control": "no-store", "set-cookie": cookie } });
  } catch {
    return Response.json({ error: "會員登入服務尚未完成設定，請聯絡管理員。" }, { status: 503 });
  }
}
