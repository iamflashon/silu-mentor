import { and, desc, eq } from "drizzle-orm";
import { memberExamAccess, members } from "../../../../db/schema";
import { requireAccountingAdmin } from "../../../../lib/member-auth";

export async function GET(request: Request) {
  const auth = await requireAccountingAdmin(request);
  if ("error" in auth) return auth.error;
  const rows = await auth.db.select({ id: memberExamAccess.id, memberId: members.id, email: members.email, displayName: members.displayName, role: members.role, status: memberExamAccess.status, canAdmin: memberExamAccess.canAdmin, className: memberExamAccess.className, lastSeenAt: members.lastSeenAt, createdAt: memberExamAccess.createdAt })
    .from(memberExamAccess).innerJoin(members, eq(memberExamAccess.memberId, members.id))
    .where(eq(memberExamAccess.examCategory, "accounting")).orderBy(desc(memberExamAccess.createdAt));
  return Response.json({ members: rows });
}

export async function POST(request: Request) {
  const auth = await requireAccountingAdmin(request);
  if ("error" in auth) return auth.error;
  const body = await request.json() as { email?: string; displayName?: string; role?: string; status?: string; canAdmin?: boolean; className?: string };
  const email = body.email?.trim().toLowerCase() ?? "";
  const displayName = body.displayName?.trim().slice(0, 80) ?? "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return Response.json({ error: "請輸入有效的 Email" }, { status: 400 });
  if (!displayName) return Response.json({ error: "請輸入會員姓名" }, { status: 400 });
  let [member] = await auth.db.select().from(members).where(eq(members.email, email)).limit(1);
  if (!member) [member] = await auth.db.insert(members).values({ email, displayName, role: body.role === "teacher" ? "teacher" : "student", status: "active", className: body.className?.trim() || "未分班" }).returning();
  const [existing] = await auth.db.select().from(memberExamAccess).where(and(eq(memberExamAccess.memberId, member.id), eq(memberExamAccess.examCategory, "accounting"))).limit(1);
  if (existing) return Response.json({ error: "這個帳號已在中級會計會員名單中" }, { status: 409 });
  const [access] = await auth.db.insert(memberExamAccess).values({ memberId: member.id, examCategory: "accounting", status: body.status === "disabled" ? "disabled" : "active", canAdmin: body.canAdmin === true, className: body.className?.trim().slice(0, 80) || "未分班" }).returning();
  return Response.json({ member: { ...member, ...access } }, { status: 201 });
}

export async function PATCH(request: Request) {
  const auth = await requireAccountingAdmin(request);
  if ("error" in auth) return auth.error;
  const body = await request.json() as { id?: number; status?: string; canAdmin?: boolean; className?: string };
  const id = Number(body.id);
  if (!id) return Response.json({ error: "缺少會員編號" }, { status: 400 });
  const status = ["active", "disabled"].includes(body.status ?? "") ? body.status : undefined;
  const canAdmin = typeof body.canAdmin === "boolean" ? body.canAdmin : undefined;
  const className = typeof body.className === "string" ? body.className.trim().slice(0, 80) || "未分班" : undefined;
  const [updated] = await auth.db.update(memberExamAccess).set({ ...(status && { status }), ...(canAdmin !== undefined && { canAdmin }), ...(className && { className }), updatedAt: new Date() }).where(and(eq(memberExamAccess.id, id), eq(memberExamAccess.examCategory, "accounting"))).returning();
  return updated ? Response.json({ member: updated }) : Response.json({ error: "找不到中級會計會員" }, { status: 404 });
}
