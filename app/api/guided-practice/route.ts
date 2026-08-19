import { and, desc, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { examQuestions, guidedPracticeSessions } from "../../../db/schema";

function userKey(request: Request) {
  return request.headers.get("oai-authenticated-user-email") ?? "default-owner";
}

function parseState(raw: string) {
  try {
    const value = JSON.parse(raw || "{}");
    return value && typeof value === "object" ? value : {};
  } catch {
    return {};
  }
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const questionId = Number(url.searchParams.get("questionId") ?? "0");
    const db = await getDb();

    if (questionId > 0) {
      const [session] = await db
        .select()
        .from(guidedPracticeSessions)
        .where(
          and(
            eq(guidedPracticeSessions.userKey, userKey(request)),
            eq(guidedPracticeSessions.questionId, questionId),
          ),
        )
        .limit(1);
      return Response.json({
        session: session
          ? {
              questionId: session.questionId,
              mode: session.mode,
              status: session.status,
              state: parseState(session.stateJson),
              updatedAt: session.updatedAt,
            }
          : null,
      });
    }

    const rows = await db
      .select({
        questionId: guidedPracticeSessions.questionId,
        mode: guidedPracticeSessions.mode,
        status: guidedPracticeSessions.status,
        stateJson: guidedPracticeSessions.stateJson,
        updatedAt: guidedPracticeSessions.updatedAt,
        year: examQuestions.year,
        subject: examQuestions.subject,
        questionNumber: examQuestions.questionNumber,
        stem: examQuestions.stem,
      })
      .from(guidedPracticeSessions)
      .innerJoin(examQuestions, eq(guidedPracticeSessions.questionId, examQuestions.id))
      .where(eq(guidedPracticeSessions.userKey, userKey(request)))
      .orderBy(desc(guidedPracticeSessions.updatedAt))
      .limit(100);

    return Response.json({
      sessions: rows.map((row) => ({
        questionId: row.questionId,
        mode: row.mode,
        status: row.status,
        state: parseState(row.stateJson),
        updatedAt: row.updatedAt,
        year: row.year,
        subject: row.subject,
        questionNumber: row.questionNumber,
        stem: row.stem,
      })),
    });
  } catch {
    return Response.json({ error: "引導學習紀錄暫時無法讀取" }, { status: 503 });
  }
}

export async function PUT(request: Request) {
  try {
    const body = (await request.json()) as {
      questionId?: number;
      mode?: string;
      status?: string;
      state?: unknown;
    };
    const questionId = Number(body.questionId);
    if (!Number.isInteger(questionId) || questionId <= 0 || !body.state || typeof body.state !== "object") {
      return Response.json({ error: "引導學習紀錄格式不正確" }, { status: 400 });
    }

    const db = await getDb();
    const [question] = await db
      .select({ id: examQuestions.id })
      .from(examQuestions)
      .where(and(eq(examQuestions.id, questionId), eq(examQuestions.status, "published")))
      .limit(1);
    if (!question) return Response.json({ error: "找不到可保存的申論題目" }, { status: 404 });

    const owner = userKey(request);
    const now = new Date();
    const stateJson = JSON.stringify(body.state);
    const [existing] = await db
      .select({ id: guidedPracticeSessions.id })
      .from(guidedPracticeSessions)
      .where(
        and(
          eq(guidedPracticeSessions.userKey, owner),
          eq(guidedPracticeSessions.questionId, questionId),
        ),
      )
      .limit(1);

    if (existing) {
      await db
        .update(guidedPracticeSessions)
        .set({
          mode: body.mode === "exam" ? "exam" : "guided",
          status: body.status === "completed" ? "completed" : "in_progress",
          stateJson,
          updatedAt: now,
        })
        .where(eq(guidedPracticeSessions.id, existing.id));
    } else {
      await db.insert(guidedPracticeSessions).values({
        userKey: owner,
        questionId,
        mode: body.mode === "exam" ? "exam" : "guided",
        status: body.status === "completed" ? "completed" : "in_progress",
        stateJson,
        createdAt: now,
        updatedAt: now,
      });
    }

    return Response.json({ saved: true, updatedAt: now });
  } catch {
    return Response.json({ error: "引導學習紀錄暫時無法保存" }, { status: 503 });
  }
}

export async function DELETE(request: Request) {
  try {
    const db = await getDb();
    await db
      .delete(guidedPracticeSessions)
      .where(eq(guidedPracticeSessions.userKey, userKey(request)));
    return Response.json({ cleared: true });
  } catch {
    return Response.json({ error: "引導學習紀錄暫時無法清空" }, { status: 503 });
  }
}
