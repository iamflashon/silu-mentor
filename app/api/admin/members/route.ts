import { desc, eq } from "drizzle-orm";
import { memberExamAccess, members } from "../../../../db/schema";
import { requireAdmin } from "../../../../lib/member-auth";
import { hashMemberPassword } from "../../../../lib/member-session-auth";

export async function GET(request: Request) {
  const auth = await requireAdmin(request);
  if ("error" in auth) return auth.error;
  const rows = await auth.db.select({ id: members.id, email: members.email, displayName: members.displayName, role: members.role, canAdmin: members.canAdmin, status: members.status, className: members.className, lastSeenAt: members.lastSeenAt, createdAt: members.createdAt }).from(members).orderBy(desc(members.lastSeenAt), desc(members.createdAt));
  const accessRows = await auth.db.select({ memberId: memberExamAccess.memberId, examCategory: memberExamAccess.examCategory, status: memberExamAccess.status, canAdmin: memberExamAccess.canAdmin, className: memberExamAccess.className }).from(memberExamAccess);
  return Response.json({ members: rows.map((member) => ({ ...member, accesses: accessRows.filter((access) => access.memberId === member.id) })) });
}

export async function POST(request: Request) {
  const auth = await requireAdmin(request);
  if ("error" in auth) return auth.error;
  const body = await request.json() as { email?: string; password?: string; displayName?: string; role?: string; canAdmin?: boolean; status?: string; className?: string };
  const email = body.email?.trim().toLowerCase() ?? "";
  const displayName = body.displayName?.trim().slice(0, 80) ?? "";
  const password = body.password ?? "";
  const className = body.className?.trim().slice(0, 80) || "未分班";
  const role = body.role === "teacher" ? "teacher" : "student";
  const status = body.status === "disabled" ? "disabled" : "active";
  const canAdmin = body.canAdmin === true;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return Response.json({ error: "請輸入有效的 Email" }, { status: 400 });
  if (!displayName) return Response.json({ error: "請輸入學員姓名" }, { status: 400 });
  if (password.length < 8) return Response.json({ error: "會員初始密碼至少需要 8 碼" }, { status: 400 });
  const [existing] = await auth.db.select({ id: members.id }).from(members).where(eq(members.email, email)).limit(1);
  if (existing) return Response.json({ error: "這個 Email 已在學員名單中" }, { status: 409 });
  const passwordHash = await hashMemberPassword(password);
  const [created] = await auth.db.insert(members).values({ email, passwordHash, displayName, role, canAdmin, status, className }).returning();
  const { passwordHash: _passwordHash, ...publicMember } = created;
  return Response.json({ member: publicMember }, { status: 201 });
}

export async function PATCH(request: Request) {
  const auth = await requireAdmin(request);
  if ("error" in auth) return auth.error;
  const body = await request.json() as { id?: number; password?: string; role?: string; canAdmin?: boolean; status?: string; className?: string };
  const id = Number(body.id);
  if (!id) return Response.json({ error: "缺少會員編號" }, { status: 400 });
  const role = ["teacher", "student"].includes(body.role ?? "") ? body.role : undefined;
  const canAdmin = typeof body.canAdmin === "boolean" ? body.canAdmin : undefined;
  const status = ["active", "disabled"].includes(body.status ?? "") ? body.status : undefined;
  const className = typeof body.className === "string" ? body.className.trim().slice(0, 80) || "未分班" : undefined;
  const password = typeof body.password === "string" ? body.password : "";
  if (password && password.length < 8) return Response.json({ error: "會員密碼至少需要 8 碼" }, { status: 400 });
  const passwordHash = password ? await hashMemberPassword(password) : undefined;
  const [updated] = await auth.db.update(members).set({ ...(passwordHash && { passwordHash }), ...(role && { role }), ...(canAdmin !== undefined && { canAdmin }), ...(status && { status }), ...(className && { className }), updatedAt: new Date() }).where(eq(members.id, id)).returning();
  if (!updated) return Response.json({ error: "找不到會員" }, { status: 404 });
  const { passwordHash: _passwordHash, ...publicMember } = updated;
  return Response.json({ member: publicMember });
}
