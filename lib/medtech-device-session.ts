import { and, desc, eq, gte, lt } from "drizzle-orm";
import { medtechDeviceSessions, medtechSecurityEvents } from "../db/schema";

export const MEDTECH_MAX_DEVICES = 2;
export const MEDTECH_DEVICE_IDLE_DAYS = 7;
const STALE_AFTER_MS = MEDTECH_DEVICE_IDLE_DAYS * 24 * 60 * 60 * 1000;
const ANOMALY_WINDOW_MS = 24 * 60 * 60 * 1000;
const ANOMALY_EVENT_COOLDOWN_MS = 6 * 60 * 60 * 1000;

type DeviceFingerprint = {
  deviceKey: string;
  ipHash: string;
  userAgentHash: string;
  deviceLabel: string;
};

type SessionDb = Awaited<ReturnType<typeof import("../db").getDb>>;

function clientIp(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || request.headers.get("cf-connecting-ip")?.trim() || request.headers.get("x-real-ip")?.trim() || "unknown";
}

function userAgent(request: Request) {
  return request.headers.get("user-agent")?.trim().slice(0, 500) || "unknown";
}

async function hashText(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function deviceLabelFromUserAgent(value: string) {
  const browser = /Edg\//u.test(value) ? "Edge" : /Chrome\//u.test(value) ? "Chrome" : /Firefox\//u.test(value) ? "Firefox" : /Safari\//u.test(value) ? "Safari" : "瀏覽器";
  const platform = /iPhone|iPad/u.test(value) ? "iPhone／iPad" : /Android/u.test(value) ? "Android" : /Mac OS X/u.test(value) ? "Mac" : /Windows/u.test(value) ? "Windows" : /Linux/u.test(value) ? "Linux" : "裝置";
  return `${browser} · ${platform}`;
}

export async function buildMedtechDeviceFingerprint(request: Request): Promise<DeviceFingerprint> {
  const ip = clientIp(request);
  const ua = userAgent(request);
  const clientHints = [
    request.headers.get("sec-ch-ua") || "",
    request.headers.get("sec-ch-ua-platform") || "",
    request.headers.get("accept-language") || "",
  ].join("|");
  const [ipHash, userAgentHash, deviceKey] = await Promise.all([
    hashText(ip),
    hashText(ua),
    hashText(`${ua}|${clientHints}`),
  ]);
  return { deviceKey, ipHash, userAgentHash, deviceLabel: deviceLabelFromUserAgent(ua) };
}

async function recordSecurityEvent(db: SessionDb, values: {
  userKey: string;
  eventType: string;
  outcome: string;
  fingerprint?: DeviceFingerprint;
  metadata?: Record<string, unknown>;
}) {
  await db.insert(medtechSecurityEvents).values({
    userKey: values.userKey,
    eventType: values.eventType,
    outcome: values.outcome,
    deviceKey: values.fingerprint?.deviceKey || "",
    deviceLabel: values.fingerprint?.deviceLabel || "未知裝置",
    ipHash: values.fingerprint?.ipHash || "",
    metadataJson: JSON.stringify(values.metadata || {}),
  });
}

async function expireStaleSessions(db: SessionDb, userKey: string, now: Date) {
  await db.update(medtechDeviceSessions)
    .set({ status: "expired" })
    .where(and(
      eq(medtechDeviceSessions.userKey, userKey),
      eq(medtechDeviceSessions.status, "active"),
      lt(medtechDeviceSessions.lastSeenAt, new Date(now.getTime() - STALE_AFTER_MS)),
    ));
}

async function findActiveSessions(db: SessionDb, userKey: string) {
  return db.select().from(medtechDeviceSessions)
    .where(and(eq(medtechDeviceSessions.userKey, userKey), eq(medtechDeviceSessions.status, "active")))
    .orderBy(desc(medtechDeviceSessions.lastSeenAt));
}

async function detectAnomaly(db: SessionDb, userKey: string, fingerprint: DeviceFingerprint, now: Date) {
  const since = new Date(now.getTime() - ANOMALY_WINDOW_MS);
  const recentSessions = await db.select({ ipHash: medtechDeviceSessions.ipHash })
    .from(medtechDeviceSessions)
    .where(and(eq(medtechDeviceSessions.userKey, userKey), gte(medtechDeviceSessions.lastSeenAt, since)));
  const recentEvents = await db.select({ eventType: medtechSecurityEvents.eventType, createdAt: medtechSecurityEvents.createdAt })
    .from(medtechSecurityEvents)
    .where(and(eq(medtechSecurityEvents.userKey, userKey), gte(medtechSecurityEvents.createdAt, since)));
  const ipCount = new Set(recentSessions.map((row) => row.ipHash).filter(Boolean)).size;
  const blockedCount = recentEvents.filter((row) => row.eventType === "device_limit").length;
  const signal = ipCount >= 3 || blockedCount >= 3;
  if (!signal) return { flagged: false, reason: "" };
  const cooldownSince = new Date(now.getTime() - ANOMALY_EVENT_COOLDOWN_MS);
  const hasRecentAlert = recentEvents.some((row) => row.eventType === "ip_anomaly" && row.createdAt >= cooldownSince);
  if (!hasRecentAlert) {
    await recordSecurityEvent(db, {
      userKey,
      eventType: "ip_anomaly",
      outcome: "review",
      fingerprint,
      metadata: { distinctIpHashes24h: ipCount, blockedDeviceAttempts24h: blockedCount },
    });
  }
  return {
    flagged: true,
    reason: ipCount >= 3 ? "24 小時內出現多個網路來源" : "24 小時內多次嘗試超過裝置上限",
  };
}

export async function registerMedtechDevice(db: SessionDb, userKey: string, request: Request, path = "") {
  const now = new Date();
  const fingerprint = await buildMedtechDeviceFingerprint(request);
  await expireStaleSessions(db, userKey, now);
  let [session] = await db.select().from(medtechDeviceSessions).where(and(
    eq(medtechDeviceSessions.userKey, userKey),
    eq(medtechDeviceSessions.deviceKey, fingerprint.deviceKey),
  )).limit(1);
  const activeSessions = await findActiveSessions(db, userKey);
  let reloginLastSeenAt: Date | null = null;

  if (session?.status === "active") {
    [session] = await db.update(medtechDeviceSessions).set({
      deviceLabel: fingerprint.deviceLabel,
      ipHash: fingerprint.ipHash,
      userAgentHash: fingerprint.userAgentHash,
      lastPath: path.slice(0, 180),
      lastSeenAt: now,
    }).where(eq(medtechDeviceSessions.id, session.id)).returning();
  } else if (activeSessions.length < MEDTECH_MAX_DEVICES) {
    if (session?.status === "expired") reloginLastSeenAt = session.lastSeenAt;
    [session] = session
      ? await db.update(medtechDeviceSessions).set({
        status: "active",
        deviceLabel: fingerprint.deviceLabel,
        ipHash: fingerprint.ipHash,
        userAgentHash: fingerprint.userAgentHash,
        lastPath: path.slice(0, 180),
        lastSeenAt: now,
      }).where(eq(medtechDeviceSessions.id, session.id)).returning()
      : await db.insert(medtechDeviceSessions).values({
        userKey,
        deviceKey: fingerprint.deviceKey,
        deviceLabel: fingerprint.deviceLabel,
        ipHash: fingerprint.ipHash,
        userAgentHash: fingerprint.userAgentHash,
        lastPath: path.slice(0, 180),
        status: "active",
        firstSeenAt: now,
        lastSeenAt: now,
      }).returning();
    await recordSecurityEvent(db, { userKey, eventType: "new_device", outcome: "allowed", fingerprint, metadata: { path } });
  } else {
    const [recentLimitEvent] = await db.select({ id: medtechSecurityEvents.id }).from(medtechSecurityEvents).where(and(
      eq(medtechSecurityEvents.userKey, userKey),
      eq(medtechSecurityEvents.eventType, "device_limit"),
      eq(medtechSecurityEvents.deviceKey, fingerprint.deviceKey),
      gte(medtechSecurityEvents.createdAt, new Date(now.getTime() - 10 * 60 * 1000)),
    )).limit(1);
    if (!recentLimitEvent) await recordSecurityEvent(db, { userKey, eventType: "device_limit", outcome: "blocked", fingerprint, metadata: { maxDevices: MEDTECH_MAX_DEVICES, path } });
  }

  const sessions = await findActiveSessions(db, userKey);
  const anomaly = await detectAnomaly(db, userKey, fingerprint, now);
  return {
    allowed: Boolean(session?.status === "active" && sessions.some((item) => item.id === session?.id)),
    blocked: !(session?.status === "active" && sessions.some((item) => item.id === session?.id)),
    current: session || null,
    sessions,
    anomaly,
    maxDevices: MEDTECH_MAX_DEVICES,
    reloginNotice: reloginLastSeenAt ? { lastLoginAt: reloginLastSeenAt } : null,
  };
}

export async function getMedtechDeviceStatus(db: SessionDb, userKey: string, request: Request, path = "") {
  return registerMedtechDevice(db, userKey, request, path);
}

export async function kickMedtechDevice(db: SessionDb, userKey: string, sessionId: number, actorRequest: Request) {
  const [target] = await db.select().from(medtechDeviceSessions).where(and(
    eq(medtechDeviceSessions.id, sessionId),
    eq(medtechDeviceSessions.userKey, userKey),
    eq(medtechDeviceSessions.status, "active"),
  )).limit(1);
  if (!target) return null;
  await db.update(medtechDeviceSessions).set({ status: "kicked" }).where(eq(medtechDeviceSessions.id, target.id));
  const fingerprint = await buildMedtechDeviceFingerprint(actorRequest);
  await recordSecurityEvent(db, {
    userKey,
    eventType: "kick_device",
    outcome: "allowed",
    fingerprint,
    metadata: { targetSessionId: target.id, targetDeviceLabel: target.deviceLabel },
  });
  return target;
}

export async function listMedtechSecurity(db: SessionDb, limit = 100) {
  const sessions = await db.select().from(medtechDeviceSessions).orderBy(desc(medtechDeviceSessions.lastSeenAt)).limit(Math.min(500, Math.max(1, limit)));
  const events = await db.select().from(medtechSecurityEvents).orderBy(desc(medtechSecurityEvents.createdAt)).limit(Math.min(500, Math.max(1, limit)));
  return { sessions, events };
}
