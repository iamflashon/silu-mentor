import { count, eq } from "drizzle-orm";
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
  memberAccountDeletionAudits,
  memberExamAccess,
  members,
  savedNotes,
  aiPaymentOrders,
} from "../../../../db/schema";
import { requireMember } from "../../../../lib/member-auth";
import { clearMemberSessionCookie, verifyMemberPassword } from "../../../../lib/member-session-auth";

export const dynamic = "force-dynamic";

export async function DELETE(request: Request) {
  const auth = await requireMember(request);
  if ("error" in auth) return auth.error;
  if (auth.member.canAdmin) return Response.json({ error: "總管理者帳號不可由前台刪除。" }, { status: 403 });

  const body = (await request.json().catch(() => null)) as { confirmation?: string; email?: string; password?: string } | null;
  if (body?.confirmation !== "刪除我的帳號" || body.email?.trim().toLowerCase() !== auth.member.email.trim().toLowerCase()) {
    return Response.json({ error: "確認文字或會員帳號不符。" }, { status: 400 });
  }

  const [credential] = await auth.db.select({ passwordHash: members.passwordHash }).from(members).where(eq(members.id, auth.member.id)).limit(1);
  if (!credential?.passwordHash || !(await verifyMemberPassword(body?.password ?? "", credential.passwordHash))) {
    return Response.json({ error: "目前密碼不正確。" }, { status: 401 });
  }

  const email = auth.member.email.trim().toLowerCase();
  const deletionRef = `DEL-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
  const deletedUserKey = `deleted:${deletionRef}`;
  const digest = async (value: string) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)))).map((byte) => byte.toString(16).padStart(2, "0")).join("");
  const forwardedIp = request.headers.get("cf-connecting-ip") ?? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "";
  const [paymentCount] = await auth.db.select({ value: count() }).from(medtechPaymentOrders).where(eq(medtechPaymentOrders.userKey, email));
  const [aiPaymentCount] = await auth.db.select({ value: count() }).from(aiPaymentOrders).where(eq(aiPaymentOrders.memberId, auth.member.id));
  await auth.db.insert(memberAccountDeletionAudits).values({ deletionRef, ipHash: forwardedIp ? await digest(forwardedIp) : "", userAgentHash: await digest(request.headers.get("user-agent") ?? ""), retainedPaymentOrders: (paymentCount?.value ?? 0) + (aiPaymentCount?.value ?? 0) });
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
    await auth.db.update(aiPaymentOrders).set({ memberId: null, updatedAt: new Date() }).where(eq(aiPaymentOrders.memberId, auth.member.id));
    await auth.db.delete(medtechMemberEntitlements).where(eq(medtechMemberEntitlements.memberId, auth.member.id));
    await auth.db.delete(memberExamAccess).where(eq(memberExamAccess.memberId, auth.member.id));
    await auth.db.delete(members).where(eq(members.id, auth.member.id));
    await auth.db.update(memberAccountDeletionAudits).set({ outcome: "completed", paymentDataAnonymized: true, learningDataDeleted: true, completedAt: new Date() }).where(eq(memberAccountDeletionAudits.deletionRef, deletionRef));
    return Response.json({ ok: true, deletionRef }, { headers: { "cache-control": "no-store", "set-cookie": clearMemberSessionCookie() } });
  } catch (error) {
    await auth.db.update(memberAccountDeletionAudits).set({ outcome: "failed" }).where(eq(memberAccountDeletionAudits.deletionRef, deletionRef)).catch(() => undefined);
    console.error("[member-account-delete] failed", { memberId: auth.member.id, error });
    return Response.json({ error: "帳號刪除未完成，請稍後重試。" }, { status: 500 });
  }
}
