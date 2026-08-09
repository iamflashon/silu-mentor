import { desc, eq } from "drizzle-orm";
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
    rating?: number;
    errorTypes?: string[];
    studentNote?: string;
    model?: string;
    originalPrompt?: string;
    solRequested?: boolean;
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
  const allowedErrors = new Set(["missing_issue", "wrong_law", "wrong_application", "unclear_conclusion", "conflicts_source", "hard_to_understand", "other"]);
  const errorTypes = Array.isArray(body.errorTypes) ? body.errorTypes.map(String).filter((item) => allowedErrors.has(item)).slice(0, 7) : [];
  const [created] = await db.insert(messageFeedback).values({
    userKey: request.headers.get("oai-authenticated-user-email") ?? "default-owner",
    sessionId: Number(body.sessionId) || null,
    messageIndex: Number(body.messageIndex) || 0,
    feedbackType,
    messageText: String(body.messageText ?? "").slice(0, 6000),
    rating: Math.max(0, Math.min(5, Math.round(Number(body.rating) || 0))),
    errorTypesJson: JSON.stringify(errorTypes),
    studentNote: String(body.studentNote ?? "").slice(0, 1500),
    model: String(body.model ?? "").slice(0, 100),
    originalPrompt: String(body.originalPrompt ?? "").slice(0, 3000),
    solRequested: Boolean(body.solRequested),
    reviewStatus: body.solRequested ? "ai_review_requested" : "pending",
    updatedAt: new Date(),
  }).returning();
  return Response.json({ ok: true, feedback: created });
}

export async function GET(request: Request) {
  if (request.headers.get("oai-authenticated-user-email") !== "iamflashon@gmail.com") return Response.json({ error: "沒有管理權限" }, { status: 403 });
  const db = await getDb();
  const rows = await db.select().from(messageFeedback).orderBy(desc(messageFeedback.updatedAt)).limit(200);
  return Response.json({ feedback: rows.map((row) => ({ ...row, errorTypes: JSON.parse(row.errorTypesJson || "[]") })) });
}

export async function PATCH(request: Request) {
  if (request.headers.get("oai-authenticated-user-email") !== "iamflashon@gmail.com") return Response.json({ error: "沒有管理權限" }, { status: 403 });
  const body = await request.json() as { id?: number; reviewStatus?: string; teacherDecision?: string; teacherNote?: string; correctedContent?: string; solReview?: string };
  const id = Number(body.id);
  const statuses = new Set(["pending", "ai_review_requested", "ai_reviewed", "teacher_confirmed", "dismissed", "corrected"]);
  if (!Number.isInteger(id) || !statuses.has(String(body.reviewStatus))) return Response.json({ error: "更新格式不正確" }, { status: 400 });
  const db = await getDb();
  await db.update(messageFeedback).set({ reviewStatus: String(body.reviewStatus), teacherDecision: String(body.teacherDecision ?? "").slice(0, 100), teacherNote: String(body.teacherNote ?? "").slice(0, 2000), correctedContent: String(body.correctedContent ?? "").slice(0, 8000), solReview: String(body.solReview ?? "").slice(0, 8000), updatedAt: new Date() }).where(eq(messageFeedback.id, id));
  return Response.json({ ok: true });
}
