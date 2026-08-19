import { desc, eq } from "drizzle-orm";
import { members } from "../../../../db/schema";
import { requireAdmin } from "../../../../lib/member-auth";

export async function GET(request: Request) {
  const auth = await requireAdmin(request);
  if ("error" in auth) return auth.error;
  const rows = await auth.db.select().from(members).orderBy(desc(members.lastSeenAt), desc(members.createdAt));
  return Response.json({ members: rows });
}

export async function POST(request: Request) {
  const auth = await requireAdmin(request);
  if ("error" in auth) return auth.error;
  const body = await request.json() as { email?: string; displayName?: string; role?: string; canAdmin?: boolean; status?: string; className?: string };
  const email = body.email?.trim().toLowerCase() ?? "";
  const displayName = body.displayName?.trim().slice(0, 80) ?? "";
  const className = body.className?.trim().slice(0, 80) || "未分班";
  const role = body.role === "teacher" ? "teacher" : "student";
  const status = body.status === "disabled" ? "disabled" : "active";
  const canAdmin = body.canAdmin === true;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return Response.json({ error: "請輸入有效的 Email" }, { status: 400 });
  if (!displayName) return Response.json({ error: "請輸入學員姓名" }, { status: 400 });
  const [existing] = await auth.db.select({ id: members.id }).from(members).where(eq(members.email, email)).limit(1);
  if (existing) return Response.json({ error: "這個 Email 已在學員名單中" }, { status: 409 });
  const [created] = await auth.db.insert(members).values({ email, displayName, role, canAdmin, status, className }).returning();
  return Response.json({ member: created }, { status: 201 });
}

export async function PATCH(request: Request) {
  const auth = await requireAdmin(request);
  if ("error" in auth) return auth.error;
  const body = await request.json() as { id?: number; role?: string; canAdmin?: boolean; status?: string; className?: string };
  const id = Number(body.id);
  if (!id) return Response.json({ error: "缺少會員編號" }, { status: 400 });
  const role = ["teacher", "student"].includes(body.role ?? "") ? body.role : undefined;
  const canAdmin = typeof body.canAdmin === "boolean" ? body.canAdmin : undefined;
  const status = ["active", "disabled"].includes(body.status ?? "") ? body.status : undefined;
  const className = typeof body.className === "string" ? body.className.trim().slice(0, 80) || "未分班" : undefined;
  const [updated] = await auth.db.update(members).set({ ...(role && { role }), ...(canAdmin !== undefined && { canAdmin }), ...(status && { status }), ...(className && { className }), updatedAt: new Date() }).where(eq(members.id, id)).returning();
  return updated ? Response.json({ member: updated }) : Response.json({ error: "找不到會員" }, { status: 404 });
}
