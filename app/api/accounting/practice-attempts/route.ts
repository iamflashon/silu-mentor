import { desc, eq } from "drizzle-orm";
import { accountingPracticeAttempts } from "../../../../db/schema";
import { requireMember } from "../../../../lib/member-auth";

export async function GET(request: Request) {
  const auth = await requireMember(request);
  if ("error" in auth) return auth.error;
  const rows = await auth.db
    .select()
    .from(accountingPracticeAttempts)
    .where(eq(accountingPracticeAttempts.memberId, auth.member.id))
    .orderBy(desc(accountingPracticeAttempts.createdAt))
    .limit(2000);
  const latest = new Map<number, (typeof rows)[number]>();
  for (const row of rows)
    if (!latest.has(row.questionId)) latest.set(row.questionId, row);
  const chapterNumber = Number(
    new URL(request.url).searchParams.get("chapterNumber"),
  );
  const attempts = [...latest.values()].filter(
    (row) => !chapterNumber || row.chapterNumber === chapterNumber,
  );
  return Response.json(
    { wrongCount: attempts.filter((row) => !row.isCorrect).length, attempts },
    { headers: { "cache-control": "no-store" } },
  );
}

export async function POST(request: Request) {
  const auth = await requireMember(request);
  if ("error" in auth) return auth.error;
  const body = (await request.json()) as {
    questionId?: number;
    chapterNumber?: number;
    selectedAnswer?: string;
    correctAnswer?: string;
    elapsedSeconds?: number;
    practiceMode?: string;
  };
  const questionId = Math.floor(Number(body.questionId));
  const chapterNumber = Math.max(
    1,
    Math.min(18, Math.floor(Number(body.chapterNumber || 1))),
  );
  const selectedAnswer = String(body.selectedAnswer || "").toUpperCase();
  const correctAnswer = String(body.correctAnswer || "").toUpperCase();
  if (
    !questionId ||
    !["A", "B", "C", "D"].includes(selectedAnswer) ||
    !["A", "B", "C", "D"].includes(correctAnswer)
  )
    return Response.json({ error: "作答資料不完整" }, { status: 400 });
  const [attempt] = await auth.db
    .insert(accountingPracticeAttempts)
    .values({
      memberId: auth.member.id,
      questionId,
      chapterNumber,
      selectedAnswer,
      correctAnswer,
      isCorrect: selectedAnswer === correctAnswer,
      elapsedSeconds: Math.max(
        0,
        Math.min(86400, Math.floor(Number(body.elapsedSeconds || 0))),
      ),
      practiceMode: String(body.practiceMode || "ordered").slice(0, 20),
    })
    .returning();
  return Response.json({ attempt });
}
