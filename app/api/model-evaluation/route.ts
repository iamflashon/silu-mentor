import { desc, inArray } from "drizzle-orm";
import { getDb } from "../../../db";
import { chatComparisonRatings, chatComparisonResponses, chatComparisons } from "../../../db/schema";

type Rubric = {
  rule: number; application: number; premise: number; facts: number;
  sources: number; continuity: number; teaching: number;
  fatal: string[]; note: string;
};

export async function GET() {
  const db = await getDb();
  const comparisons = await db.select().from(chatComparisons).orderBy(desc(chatComparisons.createdAt)).limit(50);
  const ids = comparisons.map((item) => item.id);
  const responses = ids.length ? await db.select().from(chatComparisonResponses).where(inArray(chatComparisonResponses.comparisonId, ids)) : [];
  const responseIds = responses.map((item) => item.id);
  const ratings = responseIds.length ? await db.select().from(chatComparisonRatings).where(inArray(chatComparisonRatings.responseId, responseIds)) : [];
  return Response.json({
    target: 50,
    comparisons: comparisons.map((comparison, index) => ({
      ...comparison,
      sequence: comparisons.length - index,
      responses: responses.filter((response) => response.comparisonId === comparison.id).map((response) => ({
        ...response,
        evaluations: ratings.filter((rating) => rating.responseId === response.id && rating.feedbackType === "legal_rubric").map((rating) => {
          try { return { id: rating.id, score: rating.score, createdAt: rating.createdAt, ...JSON.parse(rating.note) }; }
          catch { return { id: rating.id, score: rating.score, createdAt: rating.createdAt }; }
        }),
      })),
    })),
  });
}

export async function POST(request: Request) {
  const body = await request.json() as { responseId?: number; rubric?: Rubric };
  const responseId = Number(body.responseId) || 0;
  const rubric = body.rubric;
  if (!responseId || !rubric) return Response.json({ error: "評分資料不完整" }, { status: 400 });
  const db = await getDb();
  const [response] = await db.select().from(chatComparisonResponses).where(inArray(chatComparisonResponses.id, [responseId])).limit(1);
  if (!response) return Response.json({ error: "找不到模型回答" }, { status: 404 });
  const values = [rubric.rule, rubric.application, rubric.premise, rubric.facts, rubric.sources, rubric.continuity, rubric.teaching];
  if (values.some((value) => !Number.isFinite(value) || value < 0 || value > 5)) return Response.json({ error: "各項評分須為 0 至 5 分" }, { status: 400 });
  const weighted = Math.round((rubric.rule * 25 + rubric.application * 20 + rubric.premise * 15 + rubric.facts * 15 + rubric.sources * 10 + rubric.continuity * 10 + rubric.teaching * 5) / 5);
  const score = rubric.fatal.length ? 0 : weighted;
  const note = JSON.stringify({ ...rubric, note: String(rubric.note ?? "").slice(0, 600), weighted, disqualified: rubric.fatal.length > 0 });
  await db.insert(chatComparisonRatings).values({ comparisonId: response.comparisonId, responseId, userKey: request.headers.get("oai-authenticated-user-email") ?? "default-owner", score, feedbackType: "legal_rubric", note });
  return Response.json({ ok: true, score, weighted, disqualified: rubric.fatal.length > 0 });
}
