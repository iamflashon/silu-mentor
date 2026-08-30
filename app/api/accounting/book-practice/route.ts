import { and, asc, desc, eq, inArray, like, or } from "drizzle-orm";
import {
  accountingMemberEntitlements,
  accountingPracticeAttempts,
  documents,
  examQuestions,
} from "../../../../db/schema";
import { requireMember } from "../../../../lib/member-auth";
import {
  ACCOUNTING_FIRST_PRODUCT_KEY,
  ACCOUNTING_FIRST_PRODUCT_TITLE,
  getAccountingProductSettings,
} from "../../../../lib/accounting-product-settings";
import { removeAccountingPageFurniture } from "../../../../lib/accounting-question";
import { accountingChapterForNotes } from "../../../../lib/accounting-book-chapters";
import { sanitizeRichHtml } from "../../../../lib/rich-html";

export async function GET(request: Request) {
  const auth = await requireMember(request);
  if ("error" in auth) return auth.error;
  const url = new URL(request.url),
    page = Math.max(1, Number(url.searchParams.get("page") || 1)),
    chapterNumber = Math.max(
      1,
      Math.min(
        18,
        Math.floor(Number(url.searchParams.get("chapterNumber") || 1)),
      ),
    );
  const questionOrder =
    url.searchParams.get("questionOrder") === "random" ? "random" : "ordered";
  const seed = Math.floor(Number(url.searchParams.get("seed") || 1)) || 1;
  const preview = url.searchParams.get("preview") === "1";
  const wrongReview = url.searchParams.get("review") === "wrong";
  const product = await getAccountingProductSettings(auth.db),
    now = new Date();
  const entitlements = await auth.db
    .select()
    .from(accountingMemberEntitlements)
    .where(
      and(
        eq(accountingMemberEntitlements.memberId, auth.member.id),
        eq(accountingMemberEntitlements.status, "active"),
      ),
    );
  const wholeEntitlement = entitlements.find(
      (item) =>
        item.productKey === ACCOUNTING_FIRST_PRODUCT_KEY &&
        item.expiresAt > now,
    ),
    chapterEntitlement = entitlements.find(
      (item) =>
        item.productKey ===
          `${ACCOUNTING_FIRST_PRODUCT_KEY}:chapter:${chapterNumber}` &&
        item.expiresAt > now,
    );
  const paidAccess =
      auth.member.role === "admin" ||
      Boolean(wholeEntitlement || chapterEntitlement),
    trialAccess = chapterNumber === 1,
    canPractice = paidAccess || trialAccess;
  const docs = await auth.db
    .select({ id: documents.id })
    .from(documents)
    .where(
      or(
        like(documents.bookTitle, `%${ACCOUNTING_FIRST_PRODUCT_TITLE}%`),
        like(documents.fileName, "%51MM320901%"),
        like(documents.fileName, `%${ACCOUNTING_FIRST_PRODUCT_TITLE}%`),
      ),
    );
  const sources = docs.map((row) => `document:${row.id}`);
  const baseWhere = sources.length
    ? and(
        inArray(examQuestions.sourceUrl, sources),
        eq(examQuestions.status, "published"),
        eq(examQuestions.examCategory, "accounting"),
        eq(examQuestions.examType, "mcq"),
      )
    : eq(examQuestions.id, -1);
  const allRows = sources.length
    ? await auth.db
        .select()
        .from(examQuestions)
        .where(baseWhere)
        .orderBy(asc(examQuestions.id))
    : [];
  let chapterRows = allRows.filter(
    (item) =>
      accountingChapterForNotes(item.teacherNotes)?.number === chapterNumber,
  );
  if (wrongReview) {
    const attempts = await auth.db
      .select()
      .from(accountingPracticeAttempts)
      .where(eq(accountingPracticeAttempts.memberId, auth.member.id))
      .orderBy(desc(accountingPracticeAttempts.createdAt))
      .limit(2000);
    const latest = new Map<number, boolean>();
    for (const attempt of attempts)
      if (!latest.has(attempt.questionId))
        latest.set(attempt.questionId, attempt.isCorrect);
    chapterRows = chapterRows.filter((item) => latest.get(item.id) === false);
  }
  const orderedRows =
    questionOrder === "random"
      ? [...chapterRows].sort((a, b) => {
          const rank = (id: number) =>
            Math.imul((id ^ seed) >>> 0, 2654435761) >>> 0;
          return rank(a.id) - rank(b.id) || a.id - b.id;
        })
      : chapterRows;
  const allowedTotal = paidAccess
    ? chapterRows.length
    : trialAccess
      ? Math.min(product.trialQuestions, chapterRows.length)
      : 0;
  const rows =
    canPractice && !preview
      ? orderedRows.slice(
          paidAccess ? (page - 1) * 10 : 0,
          paidAccess ? page * 10 : product.trialQuestions,
        )
      : [];
  return Response.json(
    {
      items: rows.map((item) => ({
        ...item,
        stem: removeAccountingPageFurniture(item.stem) ?? "",
        explanation: sanitizeRichHtml(
          removeAccountingPageFurniture(item.explanation) ?? "",
        ),
      })),
      total: allowedTotal,
      bookTotal: allRows.length,
      chapterTotal: chapterRows.length,
      trialLimit: product.trialQuestions,
      wrongReview,
      paidAccess,
      trialAccess,
      hasWholeBook: auth.member.role === "admin" || Boolean(wholeEntitlement),
      expiresAt: (wholeEntitlement || chapterEntitlement)?.expiresAt ?? null,
    },
    { headers: { "cache-control": "no-store" } },
  );
}
