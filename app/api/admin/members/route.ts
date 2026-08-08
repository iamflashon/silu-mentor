import { desc, eq } from "drizzle-orm";
import { members } from "../../../../db/schema";
import { requireAdmin } from "../../../../lib/member-auth";

export async function GET(request: Request) {
  const auth = await requireAdmin(request);
  if ("error" in auth) return auth.error;
  const rows = await auth.db.select().from(members).orderBy(desc(members.lastSeenAt), desc(members.createdAt));
  return Response.json({ members: rows });
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
