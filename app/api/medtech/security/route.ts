import { desc } from "drizzle-orm";
import { members } from "../../../../db/schema";
import { listMedtechSecurity } from "../../../../lib/medtech-device-session";
import { requireMedtechAdmin } from "../../../../lib/member-auth";

function parseMetadata(value: string) {
  try { return JSON.parse(value || "{}"); } catch { return {}; }
}

export async function GET(request: Request) {
  const auth = await requireMedtechAdmin(request);
  if ("error" in auth) return auth.error;
  const { sessions, events } = await listMedtechSecurity(auth.db, Number(new URL(request.url).searchParams.get("limit")) || 100);
  const memberRows = await auth.db.select({ email: members.email, displayName: members.displayName }).from(members).orderBy(desc(members.updatedAt));
  const memberByEmail = new Map(memberRows.map((member) => [member.email, member]));
  return Response.json({
    sessions: sessions.map((session) => ({
      id: session.id,
      userKey: session.userKey,
      displayName: memberByEmail.get(session.userKey)?.displayName || session.userKey.split("@")[0],
      deviceLabel: session.deviceLabel,
      status: session.status,
      firstSeenAt: session.firstSeenAt,
      lastSeenAt: session.lastSeenAt,
      lastPath: session.lastPath,
    })),
    events: events.map((event) => ({
      id: event.id,
      userKey: event.userKey,
      displayName: memberByEmail.get(event.userKey)?.displayName || event.userKey.split("@")[0],
      eventType: event.eventType,
      outcome: event.outcome,
      deviceLabel: event.deviceLabel,
      metadata: parseMetadata(event.metadataJson),
      createdAt: event.createdAt,
    })),
    note: "IP 僅以雜湊保存；異常事件是風險提示，不單靠 IP 判定。",
  });
}
