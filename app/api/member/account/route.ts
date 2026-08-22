import { eq } from "drizzle-orm";
import {
  examAttempts,
  examCoachMessages,
  guidedPracticeSessions,
  learningPreferences,
  medtechDeviceSessions,
  medtechMemberEntitlements,
  medtechPaymentOrders,
  medtechPointLedger,
  medtechPracticeSessions,
  medtechSecurityEvents,
  medtechUsage,
  memberExamAccess,
  members,
  savedNotes,
} from "../../../../db/schema";
import { requireMember } from "../../../../lib/member-auth";
import { clearMemberSessionCookie } from "../../../../lib/member-session-auth";

export const dynamic = "force-dynamic";

export async function DELETE(request: Request) {
  const auth = await requireMember(request);
  if ("error" in auth) return auth.error;
  if (auth.member.canAdmin) return Response.json({ error: "總管理者帳號不可由前台刪除。" }, { status: 403 });

  const body = (await request.json().catch(() => null)) as { confirmation?: string; email?: string } | null;
  if (body?.confirmation !== "刪除我的帳號" || body.email?.trim().toLowerCase() !== auth.member.email.trim().toLowerCase()) {
    return Response.json({ error: "確認文字或會員帳號不符。" }, { status: 400 });
  }

  const email = auth.member.email.trim().toLowerCase();
  const deletedUserKey = `deleted:${auth.member.id}:${Date.now()}`;
  try {
    // Remove learning and identity-linked records first. The member row is
    // deleted last so an interrupted request can safely be retried.
    await auth.db.delete(examCoachMessages).where(eq(examCoachMessages.userKey, email));
    await auth.db.delete(examAttempts).where(eq(examAttempts.userKey, email));
    await auth.db.delete(guidedPracticeSessions).where(eq(guidedPracticeSessions.userKey, email));
    await auth.db.delete(savedNotes).where(eq(savedNotes.userKey, email));
    await auth.db.delete(learningPreferences).where(eq(learningPreferences.userKey, email));
    await auth.db.delete(medtechPracticeSessions).where(eq(medtechPracticeSessions.userKey, email));
    await auth.db.delete(medtechPointLedger).where(eq(medtechPointLedger.userKey, email));
    await auth.db.delete(medtechUsage).where(eq(medtechUsage.userKey, email));
    await auth.db.delete(medtechDeviceSessions).where(eq(medtechDeviceSessions.userKey, email));
    await auth.db.delete(medtechSecurityEvents).where(eq(medtechSecurityEvents.userKey, email));
    // Payment rows are retained without the member's email for accounting and
    // dispute handling. They can no longer grant access to a new registration.
    await auth.db.update(medtechPaymentOrders).set({ userKey: deletedUserKey, updatedAt: new Date() }).where(eq(medtechPaymentOrders.userKey, email));
    await auth.db.delete(medtechMemberEntitlements).where(eq(medtechMemberEntitlements.memberId, auth.member.id));
    await auth.db.delete(memberExamAccess).where(eq(memberExamAccess.memberId, auth.member.id));
    await auth.db.delete(members).where(eq(members.id, auth.member.id));
    return Response.json({ ok: true }, { headers: { "cache-control": "no-store", "set-cookie": clearMemberSessionCookie() } });
  } catch (error) {
    console.error("[member-account-delete] failed", { memberId: auth.member.id, error });
    return Response.json({ error: "帳號刪除未完成，請稍後重試。" }, { status: 500 });
  }
}
