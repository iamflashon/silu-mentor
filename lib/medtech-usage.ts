import { eq } from "drizzle-orm";
import type { getDb } from "../db";
import { medtechUsage } from "../db/schema";

export const MEDTECH_AUDIO_TRIAL_LIMIT = 3;
export const MEDTECH_STARTING_AI_CREDITS = 30;

export function medtechUserKey(request: Request) {
  return request.headers.get("oai-authenticated-user-email") ?? "default-owner";
}

export async function getOrCreateMedtechUsage(db: Awaited<ReturnType<typeof getDb>>, userKey: string) {
  const [existing] = await db.select().from(medtechUsage).where(eq(medtechUsage.userKey, userKey)).limit(1);
  if (existing) {
    // Upgrade untouched test accounts created before the 30-point trial rule.
    if (existing.aiCredits === 10 && audioTrialIds(existing).length === 0) {
      const [upgraded] = await db.update(medtechUsage).set({ aiCredits: MEDTECH_STARTING_AI_CREDITS, updatedAt: new Date() }).where(eq(medtechUsage.id, existing.id)).returning();
      return upgraded ?? existing;
    }
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
