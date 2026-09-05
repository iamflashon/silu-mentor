import { eq, sql } from "drizzle-orm";
import { getDb } from "../../../../db";
import { appSettings, judicialCases } from "../../../../db/schema";

type JsonObject = Record<string, unknown>;

function number(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : 0;
}

function text(value: unknown, max = 180) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export async function GET() {
  const db = await getDb("primary");
  const [[caseCount], [nodeRow]] = await Promise.all([
    db.select({ value: sql<number>`count(*)` }).from(judicialCases).where(eq(judicialCases.status, "active")),
    db.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, "local_node_status")).limit(1),
  ]);

  let node: JsonObject = {};
  try { node = JSON.parse(nodeRow?.value || "{}") as JsonObject; }
  catch { node = {}; }
  const source = node.judicialProgress && typeof node.judicialProgress === "object"
    ? node.judicialProgress as JsonObject
    : {};
  const lastSeenAt = text(node.lastSeenAt, 40);
  const lastSeenMs = Date.parse(lastSeenAt);
  const online = Number.isFinite(lastSeenMs) && Date.now() - lastSeenMs < 90_000;

  return Response.json({
    searchableCases: number(caseCount?.value),
    node: {
      online,
      lastSeenAt,
      version: text(node.version, 30),
      archives: number(source.archives),
      completedArchives: number(source.completedArchives),
      totalMembers: number(source.totalMembers),
      processed: number(source.processed),
      uploaded: number(source.uploaded),
      pendingUpload: number(source.pendingUpload),
      duplicates: number(source.duplicates),
      failed: number(source.failed),
      chunks: number(source.chunks),
      currentArchive: text(source.currentArchive),
      mode: text(source.mode, 20),
    },
    refreshedAt: new Date().toISOString(),
  }, { headers: { "cache-control": "no-store" } });
}
