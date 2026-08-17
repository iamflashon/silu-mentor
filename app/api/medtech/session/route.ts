import { and, desc, eq, inArray, isNotNull } from "drizzle-orm";
import { medtechPointLedger } from "../../../../db/schema";
import { getMedtechDeviceStatus, kickMedtechDevice } from "../../../../lib/medtech-device-session";
import { requireMedtechMember } from "../../../../lib/member-auth";

async function lastPackage(db: Awaited<ReturnType<typeof import("../../../../db").getDb>>, userKey: string) {
  const [grant] = await db.select({ description: medtechPointLedger.description, availableUntil: medtechPointLedger.availableUntil })
    .from(medtechPointLedger)
    .where(and(eq(medtechPointLedger.userKey, userKey), inArray(medtechPointLedger.action, ["question_pack", "question_pack_gift"]), isNotNull(medtechPointLedger.availableUntil)))
    .orderBy(desc(medtechPointLedger.createdAt)).limit(1);
  return grant ? { description: grant.description, availableUntil: grant.availableUntil } : null;
}

function publicStatus(status: Awaited<ReturnType<typeof getMedtechDeviceStatus>>, resume: Awaited<ReturnType<typeof lastPackage>> = null) {
  return {
    allowed: status.allowed,
    blocked: status.blocked,
    maxDevices: status.maxDevices,
    anomaly: status.anomaly,
    reloginNotice: status.reloginNotice,
    resume: status.reloginNotice ? resume : null,
    current: status.current ? { id: status.current.id, deviceLabel: status.current.deviceLabel, firstSeenAt: status.current.firstSeenAt, lastSeenAt: status.current.lastSeenAt } : null,
    sessions: status.sessions.map((session) => ({ id: session.id, deviceLabel: session.deviceLabel, firstSeenAt: session.firstSeenAt, lastSeenAt: session.lastSeenAt })),
  };
}

export async function GET(request: Request) {
  const auth = await requireMedtechMember(request);
  if ("error" in auth) return auth.error;
  const status = await getMedtechDeviceStatus(auth.db, auth.userKey, request, new URL(request.url).pathname);
  const resume = status.reloginNotice ? await lastPackage(auth.db, auth.userKey) : null;
  return Response.json(publicStatus(status, resume));
}

export async function POST(request: Request) {
  const auth = await requireMedtechMember(request);
  if ("error" in auth) return auth.error;
  let body: { action?: string; sessionId?: number } = {};
  try { body = await request.json() as typeof body; } catch { return Response.json({ error: "裝置操作格式錯誤。" }, { status: 400 }); }
  if (body.action !== "kick") return Response.json({ error: "不支援的裝置操作。" }, { status: 400 });
  const sessionId = Number(body.sessionId);
  if (!Number.isInteger(sessionId) || sessionId < 1) return Response.json({ error: "缺少要登出的裝置。" }, { status: 400 });
  const kicked = await kickMedtechDevice(auth.db, auth.userKey, sessionId, request);
  if (!kicked) return Response.json({ error: "這台裝置已離線或找不到，請重新整理。" }, { status: 404 });
  const status = await getMedtechDeviceStatus(auth.db, auth.userKey, request, new URL(request.url).pathname);
  return Response.json({ ok: true, kicked: { id: kicked.id, deviceLabel: kicked.deviceLabel }, ...publicStatus(status, null) });
}
