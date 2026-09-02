import { eq } from "drizzle-orm";
import { getDb } from "../db";
import { appSettings } from "../db/schema";

export const LOCAL_NODE_JOBS_KEY = "local_node_jobs_v1";

export type LocalNodeJob = {
  id: string;
  sourceFile: string;
  kind: "extract_text" | "transcode_video";
  status: "queued" | "claimed" | "completed" | "failed" | "cancelled";
  createdAt: string;
  claimedAt?: string;
  completedAt?: string;
  nodeId?: string;
  message?: string;
  resultKey?: string;
  extractedChars?: number;
  chunkCount?: number;
  pageCount?: number | null;
  examCategory: "law" | "accounting" | "medtech" | "data-structure";
  subject: string;
  documentType: string;
  bookTitle: string;
  documentId?: number;
  resourceId?: number;
  creator?: string;
  linkedBookId?: number | null;
  mediaPrefix?: string;
  hlsKey?: string;
  posterKey?: string;
  subtitleKey?: string;
  durationSeconds?: number;
  segmentCount?: number;
  indexStatus?: "queued" | "indexing" | "completed" | "failed";
};

export async function readLocalNodeJobs() {
  const db = await getDb("primary");
  const [row] = await db.select().from(appSettings).where(eq(appSettings.key, LOCAL_NODE_JOBS_KEY)).limit(1);
  if (!row?.value) return [] as LocalNodeJob[];
  try {
    const value = JSON.parse(row.value) as LocalNodeJob[];
    return Array.isArray(value) ? value.slice(0, 100) : [];
  } catch {
    return [] as LocalNodeJob[];
  }
}

export async function writeLocalNodeJobs(jobs: LocalNodeJob[]) {
  const db = await getDb("primary");
  const value = JSON.stringify(jobs.slice(0, 100));
  await db.insert(appSettings).values({ key: LOCAL_NODE_JOBS_KEY, value, updatedAt: new Date() })
    .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: new Date() } });
}

export function safeSourceFile(value: unknown) {
  const source = typeof value === "string" ? value.trim() : "";
  if (!source || source.length > 180 || source.includes("/") || source.includes("\\") || source === "." || source === "..") return "";
  return source;
}
