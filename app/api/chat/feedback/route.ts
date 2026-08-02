import { getDb } from "../../../../db";
import { messageFeedback } from "../../../../db/schema";

export async function POST(request: Request) {
  const body = await request.json() as { sessionId?: number; messageIndex?: number; feedbackType?: string; messageText?: string };
  const feedbackType = String(body.feedbackType ?? "");
  if (!["helpful", "incorrect", "not_learning", "unclear"].includes(feedbackType)) return Response.json({ error: "回饋類型不正確" }, { status: 400 });
  const db = await getDb();
  await db.insert(messageFeedback).values({ userKey: request.headers.get("oai-authenticated-user-email") ?? "default-owner", sessionId: Number(body.sessionId) || null, messageIndex: Number(body.messageIndex) || 0, feedbackType, messageText: String(body.messageText ?? "").slice(0, 1000) });
  return Response.json({ ok: true });
}
