import { and, desc, eq } from "drizzle-orm";
import { examQuestions, memberExamAccess, members, medtechMemberEntitlements, medtechPracticeSessions } from "../../../../db/schema";
import { requireMedtechAdmin } from "../../../../lib/member-auth";
import { getOrCreateMedtechUsage, normalizeMedtechUserKey } from "../../../../lib/medtech-usage";
import { hashMemberPassword } from "../../../../lib/member-session-auth";
import { MEDTECH_DEFAULT_PRODUCT_KEY, parseMedtechPermissions } from "../../../../lib/medtech-product-settings";

const OWNER_EMAIL = "iamflashon@gmail.com";

export async function GET(request: Request) {
  const auth = await requireMedtechAdmin(request);
  if ("error" in auth) return auth.error;
  const rows = await auth.db.select({ id: memberExamAccess.id, memberId: members.id, email: members.email, displayName: members.displayName, role: members.role, status: memberExamAccess.status, canAdmin: memberExamAccess.canAdmin, permissionsJson: memberExamAccess.permissionsJson, className: memberExamAccess.className, lastSeenAt: members.lastSeenAt, createdAt: memberExamAccess.createdAt })
    .from(memberExamAccess).innerJoin(members, eq(memberExamAccess.memberId, members.id))
    .where(eq(memberExamAccess.examCategory, "medtech")).orderBy(desc(memberExamAccess.createdAt));
  const usageRows = await Promise.all(rows.map(async (row) => {
    const usage = await getOrCreateMedtechUsage(auth.db, row.email);
    return { userKey: usage.userKey, points: usage.aiCredits, updatedAt: usage.updatedAt, id: usage.id };
  }));
  const pointsByEmail = new Map<string, number>();
  for (const row of [...usageRows].sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime() || right.id - left.id)) {
    const key = normalizeMedtechUserKey(row.userKey);
    if (!pointsByEmail.has(key)) pointsByEmail.set(key, row.points);
  }
  const sessions = await auth.db.select().from(medtechPracticeSessions).orderBy(desc(medtechPracticeSessions.startedAt));
  const parseIds = (value: string) => { try { const parsed = JSON.parse(value || "[]") as unknown; return Array.isArray(parsed) ? parsed.filter((id): id is number => Number.isInteger(id) && id > 0) : []; } catch { return []; } };
  const summaryByUser = new Map<string, { sessions: number; completed: number; answered: number; correct: number; durationSeconds: number; wrong: Map<number, number>; lastStartedAt: Date | null }>();
  for (const session of sessions) {
    const summary = summaryByUser.get(session.userKey) ?? { sessions: 0, completed: 0, answered: 0, correct: 0, durationSeconds: 0, wrong: new Map<number, number>(), lastStartedAt: null };
    summary.sessions += 1;
    if (session.completedAt) {
      summary.completed += 1;
      summary.answered += session.answeredQuestions;
      summary.correct += session.correctQuestions;
      summary.durationSeconds += session.durationSeconds;
      for (const id of parseIds(session.incorrectQuestionIdsJson)) summary.wrong.set(id, (summary.wrong.get(id) ?? 0) + 1);
    }
    if (!summary.lastStartedAt || session.startedAt > summary.lastStartedAt) summary.lastStartedAt = session.startedAt;
    summaryByUser.set(session.userKey, summary);
  }
  const topQuestionIds = [...summaryByUser.values()].flatMap((summary) => [...summary.wrong.keys()]);
  const topQuestions = topQuestionIds.length ? await auth.db.select({ id: examQuestions.id, year: examQuestions.year, questionNumber: examQuestions.questionNumber, subject: examQuestions.subject }).from(examQuestions).where(eq(examQuestions.examCategory, "medtech")) : [];
  const questionById = new Map(topQuestions.map((question) => [question.id, question]));
  const entitlementRows = await auth.db.select().from(medtechMemberEntitlements).where(eq(medtechMemberEntitlements.productKey, MEDTECH_DEFAULT_PRODUCT_KEY));
  const entitlementByMember = new Map(entitlementRows.map((row) => [row.memberId, row]));
  return Response.json({ canManageCommercial: auth.member.email === OWNER_EMAIL, members: rows.map((row) => {
    const summary = summaryByUser.get(row.email);
    const topWrong = summary ? [...summary.wrong.entries()].sort((left, right) => right[1] - left[1])[0] : undefined;
    const topQuestion = topWrong ? questionById.get(topWrong[0]) : undefined;
    const accuracy = summary?.answered ? Math.round((summary.correct / summary.answered) * 100) : 0;
    const entitlement = entitlementByMember.get(row.memberId);
    return { ...row, permissions: parseMedtechPermissions(row.permissionsJson), entitlement: entitlement ? { status: entitlement.status, expiresAt: entitlement.expiresAt.toISOString(), source: entitlement.source, note: entitlement.note } : null, points: pointsByEmail.get(normalizeMedtechUserKey(row.email)) ?? null, practiceStats: { sessions: summary?.sessions ?? 0, completed: summary?.completed ?? 0, answered: summary?.answered ?? 0, durationMinutes: Math.floor((summary?.durationSeconds ?? 0) / 60), accuracy, topWrong: topQuestion ? { ...topQuestion, count: topWrong?.[1] ?? 0 } : null, lastStartedAt: summary?.lastStartedAt?.toISOString() ?? null } };
  }) });
}

export async function POST(request: Request) {
  const auth = await requireMedtechAdmin(request);
  if ("error" in auth) return auth.error;
  const body = await request.json() as { email?: string; password?: string; displayName?: string; role?: string; status?: string; canAdmin?: boolean; className?: string };
  const email = body.email?.trim().toLowerCase() ?? "";
  const displayName = body.displayName?.trim().slice(0, 80) ?? "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return Response.json({ error: "請輸入有效的 Email" }, { status: 400 });
  if (!displayName) return Response.json({ error: "請輸入會員姓名" }, { status: 400 });
  if (!body.password || body.password.length < 8) return Response.json({ error: "會員初始密碼至少需要 8 碼" }, { status: 400 });
  let [member] = await auth.db.select().from(members).where(eq(members.email, email)).limit(1);
  if (!member) [member] = await auth.db.insert(members).values({ email, passwordHash: await hashMemberPassword(body.password), displayName, role: body.role === "teacher" ? "teacher" : "student", status: "active", className: body.className?.trim() || "未分班" }).returning();
  else if (!member.passwordHash) {
    [member] = await auth.db.update(members).set({ passwordHash: await hashMemberPassword(body.password), updatedAt: new Date() }).where(eq(members.id, member.id)).returning();
  }
  const [existing] = await auth.db.select().from(memberExamAccess).where(and(eq(memberExamAccess.memberId, member.id), eq(memberExamAccess.examCategory, "medtech"))).limit(1);
  if (existing) return Response.json({ error: "這個帳號已在醫檢師會員名單中" }, { status: 409 });
  const [access] = await auth.db.insert(memberExamAccess).values({ memberId: member.id, examCategory: "medtech", status: body.status === "disabled" ? "disabled" : "active", canAdmin: body.canAdmin === true, className: body.className?.trim().slice(0, 80) || "未分班" }).returning();
  const { passwordHash: _passwordHash, ...publicMember } = member;
  return Response.json({ member: { ...publicMember, ...access } }, { status: 201 });
}

export async function PATCH(request: Request) {
  const auth = await requireMedtechAdmin(request);
  if ("error" in auth) return auth.error;
  const body = await request.json() as { id?: number; status?: string; canAdmin?: boolean; className?: string; permissions?: string[] };
  const id = Number(body.id);
  if (!id) return Response.json({ error: "缺少會員編號" }, { status: 400 });
  const status = ["active", "disabled"].includes(body.status ?? "") ? body.status : undefined;
  const canAdmin = typeof body.canAdmin === "boolean" ? body.canAdmin : undefined;
  const className = typeof body.className === "string" ? body.className.trim().slice(0, 80) || "未分班" : undefined;
  const permissions = Array.isArray(body.permissions) ? body.permissions.filter((value) => ["members","documents","questions","audio","security"].includes(value)) : undefined;
  if ((canAdmin !== undefined || permissions !== undefined) && auth.member.email !== OWNER_EMAIL) return Response.json({ error: "只有總管理者可調整管理權限" }, { status: 403 });
  const [updated] = await auth.db.update(memberExamAccess).set({ ...(status && { status }), ...(canAdmin !== undefined && { canAdmin }), ...(className && { className }), ...(permissions !== undefined && { permissionsJson: JSON.stringify(permissions) }), updatedAt: new Date() }).where(and(eq(memberExamAccess.id, id), eq(memberExamAccess.examCategory, "medtech"))).returning();
  return updated ? Response.json({ member: updated }) : Response.json({ error: "找不到醫檢師會員" }, { status: 404 });
}
