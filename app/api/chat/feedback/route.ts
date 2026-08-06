import { eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { chatComparisonRatings, chatComparisonResponses, messageFeedback } from "../../../../db/schema";

export async function POST(request: Request) {
  const body = await request.json() as {
    sessionId?: number;
    messageIndex?: number;
    feedbackType?: string;
    messageText?: string;
    comparisonId?: number;
    comparisonResponseId?: number;
    score?: number;
    note?: string;
  };
  const feedbackType = String(body.feedbackType ?? "");
  const comparisonResponseId = Number(body.comparisonResponseId) || 0;
  const db = await getDb();
  if (comparisonResponseId) {
    if (!Number.isInteger(comparisonResponseId) || !["preferred", "rated", "incorrect", "unclear"].includes(feedbackType)) {
      return Response.json({ error: "模型比較回饋格式不正確" }, { status: 400 });
    }
    const [response] = await db.select().from(chatComparisonResponses).where(eq(chatComparisonResponses.id, comparisonResponseId)).limit(1);
    if (!response) return Response.json({ error: "找不到這筆模型比較回答" }, { status: 404 });
    const score = Math.max(0, Math.min(5, Math.round(Number(body.score) || (feedbackType === "preferred" ? 5 : 0))));
    await db.insert(chatComparisonRatings).values({
      comparisonId: response.comparisonId,
      responseId: response.id,
      userKey: request.headers.get("oai-authenticated-user-email") ?? "default-owner",
      score,
      feedbackType,
      note: String(body.note ?? "").slice(0, 500),
    });
    return Response.json({ ok: true, comparisonId: response.comparisonId, responseId: response.id, score });
  }
  if (!["helpful", "incorrect", "not_learning", "unclear"].includes(feedbackType)) return Response.json({ error: "回饋類型不正確" }, { status: 400 });
  await db.insert(messageFeedback).values({ userKey: request.headers.get("oai-authenticated-user-email") ?? "default-owner", sessionId: Number(body.sessionId) || null, messageIndex: Number(body.messageIndex) || 0, feedbackType, messageText: String(body.messageText ?? "").slice(0, 1000) });
  return Response.json({ ok: true });
}
