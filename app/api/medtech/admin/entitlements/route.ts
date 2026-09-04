import { and, eq } from "drizzle-orm";
import { memberExamAccess, medtechMemberEntitlements, members } from "../../../../../db/schema";
import { requireMedtechAdmin } from "../../../../../lib/member-auth";
import { MEDTECH_DEFAULT_PRODUCT_KEY } from "../../../../../lib/medtech-product-settings";

const OWNER_EMAIL = "iamflashon@gmail.com";

export async function PATCH(request: Request) {
  const auth = await requireMedtechAdmin(request);
  if ("error" in auth) return auth.error;
  if (auth.member.email !== OWNER_EMAIL) return Response.json({ error: "只有總管理者可延長或調整會員期限" }, { status: 403 });
  const body = await request.json() as { memberId?: number; email?: string; days?: number; expiresAt?: string; note?: string; revoke?: boolean; action?: "grant" | "extend" | "revoke" };
  const requestedMemberId = Number(body.memberId);
  const email = body.email?.trim().toLowerCase() ?? "";
  const [member] = Number.isInteger(requestedMemberId) && requestedMemberId > 0
    ? await auth.db.select().from(members).where(eq(members.id, requestedMemberId)).limit(1)
    : email
      ? await auth.db.select().from(members).where(eq(members.email, email)).limit(1)
      : [];
  if (!member) return Response.json({ error: "找不到這個總會員 Email，請先在總管理處新增會員" }, { status: 404 });
  const memberId = member.id;
  const [medtechAccess] = await auth.db.select().from(memberExamAccess).where(and(eq(memberExamAccess.memberId, memberId), eq(memberExamAccess.examCategory, "medtech"))).limit(1);
  if (!medtechAccess) {
    await auth.db.insert(memberExamAccess).values({ memberId, examCategory: "medtech", status: "active", canAdmin: false, permissionsJson: "[]", className: member.className || "未分班" });
  } else if (medtechAccess.status !== "active") {
    await auth.db.update(memberExamAccess).set({ status: "active", updatedAt: new Date() }).where(eq(memberExamAccess.id, medtechAccess.id));
  }
  const [existing] = await auth.db.select().from(medtechMemberEntitlements).where(and(eq(medtechMemberEntitlements.memberId, memberId), eq(medtechMemberEntitlements.productKey, MEDTECH_DEFAULT_PRODUCT_KEY))).limit(1);
  if (body.revoke || body.action === "revoke") {
    if (existing) await auth.db.update(medtechMemberEntitlements).set({ status: "revoked", updatedAt: new Date(), updatedBy: auth.member.email }).where(eq(medtechMemberEntitlements.id, existing.id));
    return Response.json({ entitlement: null });
  }
  const now = new Date();
  let expiresAt = body.expiresAt ? new Date(body.expiresAt) : null;
  if (!expiresAt || Number.isNaN(expiresAt.getTime())) {
    const days = Math.max(1, Math.min(3650, Math.round(Number(body.days || 30))));
    const base = existing?.expiresAt && existing.expiresAt > now ? existing.expiresAt : now;
    expiresAt = new Date(base.getTime() + days * 86400000);
  }
  const values = { status: "active", source: "manual", startsAt: existing?.startsAt ?? now, expiresAt, note: body.note?.trim().slice(0, 200) || "總管理者手動調整", updatedBy: auth.member.email, updatedAt: now };
  const [entitlement] = existing
    ? await auth.db.update(medtechMemberEntitlements).set(values).where(eq(medtechMemberEntitlements.id, existing.id)).returning()
    : await auth.db.insert(medtechMemberEntitlements).values({ memberId, productKey: MEDTECH_DEFAULT_PRODUCT_KEY, ...values }).returning();
  return Response.json({ entitlement, member: { id: member.id, email: member.email, displayName: member.displayName } });
}
