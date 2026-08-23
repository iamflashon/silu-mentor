import { and, eq } from "drizzle-orm";
import { getDb } from "../../../../../db";
import { memberPasswordResetRequests, members } from "../../../../../db/schema";

const GENERIC_MESSAGE = "申請已送出。若此 Email 已註冊，管理員會在後台看到申請並協助設定臨時密碼；目前不會寄送 Email。";

export async function POST(request: Request) {
  let body: { email?: string } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ message: GENERIC_MESSAGE });
  }
  const email = String(body.email ?? "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return Response.json({ message: GENERIC_MESSAGE });
  }
  const db = await getDb();
  const [member] = await db.select({ id: members.id }).from(members).where(eq(members.email, email)).limit(1);
  if (member) {
    const [pending] = await db
      .select({ id: memberPasswordResetRequests.id })
      .from(memberPasswordResetRequests)
      .where(and(eq(memberPasswordResetRequests.memberId, member.id), eq(memberPasswordResetRequests.status, "pending")))
      .limit(1);
    if (pending) {
      await db.update(memberPasswordResetRequests).set({ requestedAt: new Date() }).where(eq(memberPasswordResetRequests.id, pending.id));
    } else {
      await db.insert(memberPasswordResetRequests).values({ memberId: member.id });
    }
  }
  return Response.json({ message: GENERIC_MESSAGE });
}
