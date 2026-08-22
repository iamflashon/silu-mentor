import { eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { members } from "../../../../db/schema";
import { safeReturnTo } from "../../../../lib/admin-entry-auth";
import { createMemberSessionCookie, hashMemberPassword } from "../../../../lib/member-session-auth";

export async function POST(request: Request) {
  let body: { displayName?: unknown; email?: unknown; password?: unknown; confirmPassword?: unknown; returnTo?: unknown } = {};
  try { body = await request.json(); } catch { return Response.json({ error: "註冊資料格式錯誤。" }, { status: 400 }); }
  const displayName = typeof body.displayName === "string" ? body.displayName.trim().slice(0, 80) : "";
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";
  const confirmPassword = typeof body.confirmPassword === "string" ? body.confirmPassword : "";
  if (displayName.length < 2) return Response.json({ error: "請輸入至少 2 個字的姓名。" }, { status: 400 });
  if (!/^\S+@\S+\.\S+$/.test(email)) return Response.json({ error: "請輸入有效的 Email。" }, { status: 400 });
  if (password.length < 8) return Response.json({ error: "密碼至少需要 8 碼。" }, { status: 400 });
  if (password !== confirmPassword) return Response.json({ error: "兩次輸入的密碼不一致。" }, { status: 400 });
  try { const db = await getDb(); const [existing] = await db.select({ id: members.id }).from(members).where(eq(members.email, email)).limit(1); if (existing) return Response.json({ error: "這個 Email 已經註冊，請直接登入。" }, { status: 409 }); const [member] = await db.insert(members).values({ email, passwordHash: await hashMemberPassword(password), displayName, role: "student", status: "active", className: "未分班", lastSeenAt: new Date() }).returning({ id: members.id, email: members.email }); const cookie = await createMemberSessionCookie({ memberId: member.id, email: member.email }); if (!cookie) return Response.json({ error: "註冊服務尚未完成設定，請聯絡管理員。" }, { status: 503 }); return Response.json({ ok: true, returnTo: safeReturnTo(body.returnTo) }, { status: 201, headers: { "cache-control": "no-store", "set-cookie": cookie } }); } catch { return Response.json({ error: "註冊服務暫時無法使用，請稍後再試。" }, { status: 503 }); }
}
