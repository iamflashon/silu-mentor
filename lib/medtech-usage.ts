import { eq } from "drizzle-orm";
import type { getDb } from "../db";
import { medtechUsage } from "../db/schema";

// 醫檢師平台統一使用點數：首次登入贈 10 點，提示與比較選項走快取，
// 語音完整解析與 AI 追問各自按次扣 1 點。保留舊欄位讀取僅為相容既有資料。
export const MEDTECH_AUDIO_TRIAL_LIMIT = 0;
export const MEDTECH_STARTING_AI_CREDITS = 10;

export function medtechUserKey(request: Request) {
  return request.headers.get("oai-authenticated-user-email") ?? "default-owner";
}

export async function getOrCreateMedtechUsage(db: Awaited<ReturnType<typeof getDb>>, userKey: string) {
  const [existing] = await db.select().from(medtechUsage).where(eq(medtechUsage.userKey, userKey)).limit(1);
  if (existing) {
    return existing;
  }
  const [created] = await db.insert(medtechUsage).values({ userKey, aiCredits: MEDTECH_STARTING_AI_CREDITS }).returning();
  return created;
}

export function audioTrialIds(row: { audioTrialQuestionIdsJson: string }) {
  try {
    const ids = JSON.parse(row.audioTrialQuestionIdsJson || "[]") as unknown;
    return Array.isArray(ids) ? ids.filter((id): id is number => Number.isInteger(id) && id > 0) : [];
  } catch {
    return [];
  }
}
