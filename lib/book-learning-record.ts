import { and, eq } from "drizzle-orm";
import { chatMessages, chatSessions, studyRecords } from "../db/schema";
import type { getDb } from "../db";

type BookLearningDb = Awaited<ReturnType<typeof getDb>>;

/**
 * Keep the durable learning record in step with the book conversation.
 * One record is maintained per persisted chat session; repeated turns update
 * that record instead of creating a new row for every AI response.
 */
export async function syncBookLearningRecord(input: {
  db: BookLearningDb;
  session: typeof chatSessions.$inferSelect;
  userKey: string;
  resourceTitle: string;
  segmentTitle: string;
}) {
  const messages = await input.db
    .select()
    .from(chatMessages)
    .where(eq(chatMessages.sessionId, input.session.id));
  if (!messages.length) return null;

  const marker = "[book-session:" + input.session.id + "]";
  const title = (input.resourceTitle + "｜" + input.segmentTitle).slice(0, 180);
  const candidates = await input.db
    .select()
    .from(studyRecords)
    .where(and(
      eq(studyRecords.userKey, input.userKey),
      eq(studyRecords.activityType, "智能書學習"),
    ))
    .orderBy(studyRecords.id)
    .limit(200);
  const existing = candidates.find((record) => record.reflection.includes(marker));
  const studentCount = messages.filter((message) => message.role === "student").length;
  const mentorCount = messages.filter((message) => message.role === "mentor").length;
  const actualMinutes = Math.min(720, Math.max(5, Math.ceil(messages.length / 2) * 5));
  const lastMentor = [...messages].reverse().find((message) => message.role === "mentor")?.text ?? "";
  const reflection = marker + " 已保存 " + messages.length + " 則對話（學生 " + studentCount + " 次、AI 導師 " + mentorCount + " 次" + (messages.some((message) => message.role === "scholar") ? "，含 AI 學霸回答" : "") + "）。";
  const nextStep = lastMentor.replace(/\s+/g, " ").slice(0, 240) || "下次從目前章節的最後對話接續。";

  if (existing) {
    await input.db.update(studyRecords).set({
      actualMinutes,
      reflection,
      weakness: "",
      nextStep,
    }).where(eq(studyRecords.id, existing.id));
    return { id: existing.id, actualMinutes, messageCount: messages.length };
  }

  const [record] = await input.db.insert(studyRecords).values({
    userKey: input.userKey,
    recordDate: input.session.sessionDate ?? new Date().toISOString().slice(0, 10),
    subject: "綜合",
    title,
    activityType: "智能書學習",
    actualMinutes,
    reflection,
    nextStep,
  }).returning();
  return record ? { id: record.id, actualMinutes, messageCount: messages.length } : null;
}
