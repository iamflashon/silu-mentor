import { and, desc, eq } from "drizzle-orm";
import { documents, memberAccountDeletionAudits, memberExamAccess, memberPasswordResetRequests, medtechPaymentOrders, members, questionEditAudits } from "../../../../db/schema";
import { requireAdmin } from "../../../../lib/member-auth";
import { hashMemberPassword } from "../../../../lib/member-session-auth";

export async function GET(request: Request) {
  const auth = await requireAdmin(request);
  if ("error" in auth) return auth.error;
  const rows = await auth.db.select({ id: members.id, email: members.email, displayName: members.displayName, role: members.role, canAdmin: members.canAdmin, status: members.status, className: members.className, lastSeenAt: members.lastSeenAt, createdAt: members.createdAt }).from(members).orderBy(desc(members.lastSeenAt), desc(members.createdAt));
  const accessRows = await auth.db.select({ memberId: memberExamAccess.memberId, examCategory: memberExamAccess.examCategory, status: memberExamAccess.status, canAdmin: memberExamAccess.canAdmin, permissionsJson: memberExamAccess.permissionsJson, allowedDocumentIdsJson: memberExamAccess.allowedDocumentIdsJson, className: memberExamAccess.className }).from(memberExamAccess);
  const medtechDocuments = await auth.db.select({ id: documents.id, bookTitle: documents.bookTitle, fileName: documents.fileName, subject: documents.subject })
    .from(documents).where(eq(documents.examCategory, "medtech"));
  const paymentRows = await auth.db.select({ userKey: medtechPaymentOrders.userKey, orderId: medtechPaymentOrders.orderId, transactionId: medtechPaymentOrders.transactionId, packageName: medtechPaymentOrders.packageName, amount: medtechPaymentOrders.amount, currency: medtechPaymentOrders.currency, status: medtechPaymentOrders.status, environment: medtechPaymentOrders.environment, paidAt: medtechPaymentOrders.paidAt, activatedAt: medtechPaymentOrders.activatedAt, createdAt: medtechPaymentOrders.createdAt }).from(medtechPaymentOrders).orderBy(desc(medtechPaymentOrders.createdAt));
  const deletionAudits = await auth.db.select().from(memberAccountDeletionAudits).orderBy(desc(memberAccountDeletionAudits.requestedAt)).limit(100);
  const resetRequests = await auth.db.select().from(memberPasswordResetRequests).where(eq(memberPasswordResetRequests.status, "pending")).orderBy(desc(memberPasswordResetRequests.requestedAt));
  const editAudits = await auth.db.select().from(questionEditAudits).orderBy(desc(questionEditAudits.createdAt)).limit(500);
  return Response.json({ members: rows.map((member) => ({ ...member, passwordResetRequestedAt: resetRequests.find((item) => item.memberId === member.id)?.requestedAt ?? null, accesses: accessRows.filter((access) => access.memberId === member.id), paymentOrders: paymentRows.filter((order) => order.userKey.trim().toLowerCase() === member.email.trim().toLowerCase()) })), medtechDocuments, deletionAudits, editAudits, retainedPaymentOrders: paymentRows.filter((order) => order.userKey.startsWith("deleted:")) });
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
  const { passwordHash: _passwordHash, ...publicMember } = created;
  return Response.json({ member: publicMember }, { status: 201 });
}

export async function PATCH(request: Request) {
  const auth = await requireAdmin(request);
  if ("error" in auth) return auth.error;
  const body = await request.json() as { id?: number; password?: string; role?: string; canAdmin?: boolean; status?: string; className?: string; managementRole?: string; allowedDocumentIds?: number[] };
  const id = Number(body.id);
  if (!id) return Response.json({ error: "缺少會員編號" }, { status: 400 });
  const role = ["teacher", "student"].includes(body.role ?? "") ? body.role : undefined;
  const managementRole = ["none", "admin", "medtech-document-editor"].includes(body.managementRole ?? "") ? body.managementRole : undefined;
  const canAdmin = managementRole ? managementRole === "admin" : typeof body.canAdmin === "boolean" ? body.canAdmin : undefined;
  const status = ["active", "disabled"].includes(body.status ?? "") ? body.status : undefined;
  const className = typeof body.className === "string" ? body.className.trim().slice(0, 80) || "未分班" : undefined;
  const password = typeof body.password === "string" ? body.password : "";
  if (password && password.length < 8) return Response.json({ error: "會員密碼至少需要 8 碼" }, { status: 400 });
  const passwordHash = password ? await hashMemberPassword(password) : undefined;
  const [updated] = await auth.db.update(members).set({ ...(passwordHash && { passwordHash }), ...(role && { role }), ...(canAdmin !== undefined && { canAdmin }), ...(status && { status }), ...(className && { className }), updatedAt: new Date() }).where(eq(members.id, id)).returning();
  if (!updated) return Response.json({ error: "找不到會員" }, { status: 404 });
  let [medtechAccess] = await auth.db.select().from(memberExamAccess)
    .where(and(eq(memberExamAccess.memberId, id), eq(memberExamAccess.examCategory, "medtech"))).limit(1);
  if (managementRole === "medtech-document-editor") {
    if (medtechAccess) {
      [medtechAccess] = await auth.db.update(memberExamAccess).set({ status: "active", canAdmin: false, permissionsJson: JSON.stringify(["document-library"]), updatedAt: new Date() }).where(eq(memberExamAccess.id, medtechAccess.id)).returning();
    } else {
      [medtechAccess] = await auth.db.insert(memberExamAccess).values({ memberId: id, examCategory: "medtech", status: "active", canAdmin: false, permissionsJson: JSON.stringify(["document-library"]), className: updated.className || "未分班" }).returning();
    }
  } else if (managementRole === "none" && medtechAccess) {
    let permissions: string[] = [];
    try { const parsed = JSON.parse(medtechAccess.permissionsJson || "[]") as unknown; permissions = Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === "string") : []; } catch { permissions = []; }
    [medtechAccess] = await auth.db.update(memberExamAccess).set({ canAdmin: false, permissionsJson: JSON.stringify(permissions.filter((value) => value !== "document-library" && value !== "questions")), allowedDocumentIdsJson: "[]", updatedAt: new Date() }).where(eq(memberExamAccess.id, medtechAccess.id)).returning();
  }
  if (Array.isArray(body.allowedDocumentIds)) {
    if (!medtechAccess) return Response.json({ error: "請先將管理權限設為醫檢文件題庫編輯員" }, { status: 409 });
    const requestedIds = [...new Set(body.allowedDocumentIds.map(Number).filter((value) => Number.isInteger(value) && value > 0))];
    const available = await auth.db.select({ id: documents.id }).from(documents).where(eq(documents.examCategory, "medtech"));
    const availableIds = new Set(available.map((row) => row.id));
    const allowedDocumentIds = requestedIds.filter((documentId) => availableIds.has(documentId));
    let existingPermissions: string[] = [];
    try { const parsed = JSON.parse(medtechAccess.permissionsJson || "[]") as unknown; existingPermissions = Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === "string") : []; } catch { existingPermissions = []; }
    const scopedPermissions = [...new Set(existingPermissions.filter((value) => value !== "questions" && value !== "document-library").concat("document-library"))];
    [medtechAccess] = await auth.db.update(memberExamAccess).set({ permissionsJson: JSON.stringify(scopedPermissions), allowedDocumentIdsJson: JSON.stringify(allowedDocumentIds), updatedAt: new Date() }).where(eq(memberExamAccess.id, medtechAccess.id)).returning();
  }
  if (passwordHash) {
    await auth.db.update(memberPasswordResetRequests).set({ status: "completed", completedAt: new Date(), completedBy: auth.member.email }).where(and(eq(memberPasswordResetRequests.memberId, id), eq(memberPasswordResetRequests.status, "pending")));
  }
  const { passwordHash: _passwordHash, ...publicMember } = updated;
  const accesses = await auth.db.select({ memberId: memberExamAccess.memberId, examCategory: memberExamAccess.examCategory, status: memberExamAccess.status, canAdmin: memberExamAccess.canAdmin, permissionsJson: memberExamAccess.permissionsJson, allowedDocumentIdsJson: memberExamAccess.allowedDocumentIdsJson, className: memberExamAccess.className })
    .from(memberExamAccess).where(eq(memberExamAccess.memberId, id));
  return Response.json({ member: { ...publicMember, accesses } });
}
