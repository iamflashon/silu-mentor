import { eq } from "drizzle-orm";
import { appSettings } from "../../../../db/schema";
import { requireAdmin } from "../../../../lib/member-auth";

const STATUS_KEY = "local_node_status";
const ONLINE_WINDOW_MS = 90_000;

type StoredNodeStatus = {
  nodeId: string;
  name: string;
  status: "online" | "busy" | "error";
  lastSeenAt: string;
  version: string;
  gpu: string;
  gpuMemoryGb: number | null;
  ramGb: number | null;
  models: string[];
  queuedJobs: number;
  activeJob: string;
  message: string;
  inboxFiles?: Array<{ name: string; sizeBytes: number; modifiedAt: number }>;
  videoInboxFiles?: Array<{ name: string; sizeBytes: number; modifiedAt: number }>;
};

function parseStatus(value?: string): StoredNodeStatus | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as StoredNodeStatus;
    return parsed && typeof parsed.lastSeenAt === "string" ? parsed : null;
  } catch {
    return null;
  }
}

export async function GET(request: Request) {
  const auth = await requireAdmin(request);
  if ("error" in auth) return auth.error;
  const [row] = await auth.db.select().from(appSettings).where(eq(appSettings.key, STATUS_KEY)).limit(1);
  const node = parseStatus(row?.value);
  const lastSeenMs = node ? Date.parse(node.lastSeenAt) : 0;
  const connected = Boolean(node && Number.isFinite(lastSeenMs) && Date.now() - lastSeenMs <= ONLINE_WINDOW_MS);
  return Response.json({
    connected,
    node: node ? { ...node, status: connected ? node.status : "offline" } : null,
    offlineAfterSeconds: ONLINE_WINDOW_MS / 1000,
  }, { headers: { "cache-control": "no-store" } });
}
