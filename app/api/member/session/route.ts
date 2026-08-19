import { eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { members } from "../../../../db/schema";
import { getMemberSession } from "../../../../lib/member-session-auth";

export async function GET(request: Request) {
  const session = await getMemberSession(request);
  if (!session) return Response.json({ authenticated: false, member: null }, { headers: { "cache-control": "no-store" } });
  try {
    const db = await getDb();
    const [member] = await db.select({ id: members.id, email: members.email, displayName: members.displayName, role: members.role, canAdmin: members.canAdmin, status: members.status, className: members.className }).from(members).where(eq(members.id, session.memberId)).limit(1);
    if (!member || member.status !== "active" || member.email.trim().toLowerCase() !== session.email) return Response.json({ authenticated: false, member: null }, { headers: { "cache-control": "no-store" } });
    return Response.json({ authenticated: true, member }, { headers: { "cache-control": "no-store" } });
  } catch {
    return Response.json({ authenticated: false, member: null }, { headers: { "cache-control": "no-store" } });
  }
}
