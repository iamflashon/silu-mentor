import { and, asc, eq, inArray, like, or } from "drizzle-orm";
import { accountingMemberEntitlements, documents, examQuestions } from "../../../../db/schema";
import { requireMember } from "../../../../lib/member-auth";
import { ACCOUNTING_FIRST_PRODUCT_KEY, ACCOUNTING_FIRST_PRODUCT_TITLE, getAccountingProductSettings } from "../../../../lib/accounting-product-settings";
import { removeAccountingPageFurniture } from "../../../../lib/accounting-question";
import { accountingChapterForNotes } from "../../../../lib/accounting-book-chapters";

export async function GET(request: Request) {
  const auth = await requireMember(request); if ("error" in auth) return auth.error;
  const url = new URL(request.url), page = Math.max(1, Number(url.searchParams.get("page") || 1)), chapterNumber = Math.max(1, Math.min(18, Math.floor(Number(url.searchParams.get("chapterNumber") || 1))));
  const product = await getAccountingProductSettings(auth.db), now = new Date();
  const entitlements = await auth.db.select().from(accountingMemberEntitlements).where(and(eq(accountingMemberEntitlements.memberId, auth.member.id), eq(accountingMemberEntitlements.status, "active")));
  const wholeEntitlement = entitlements.find((item) => item.productKey === ACCOUNTING_FIRST_PRODUCT_KEY && item.expiresAt > now), chapterEntitlement = entitlements.find((item) => item.productKey === `${ACCOUNTING_FIRST_PRODUCT_KEY}:chapter:${chapterNumber}` && item.expiresAt > now);
  const paidAccess = auth.member.role === "admin" || Boolean(wholeEntitlement || chapterEntitlement), trialAccess = chapterNumber === 1, canPractice = paidAccess || trialAccess;
  const docs = await auth.db.select({ id: documents.id }).from(documents).where(or(like(documents.bookTitle, `%${ACCOUNTING_FIRST_PRODUCT_TITLE}%`), like(documents.fileName, "%51MM320901%"), like(documents.fileName, `%${ACCOUNTING_FIRST_PRODUCT_TITLE}%`)));
  const sources = docs.map((row) => `document:${row.id}`);
  const baseWhere = sources.length ? and(inArray(examQuestions.sourceUrl, sources), eq(examQuestions.status, "published"), eq(examQuestions.examCategory, "accounting"), eq(examQuestions.examType, "mcq")) : eq(examQuestions.id, -1);
  const allRows = sources.length ? await auth.db.select().from(examQuestions).where(baseWhere).orderBy(asc(examQuestions.id)) : [];
  const chapterRows = allRows.filter((item) => accountingChapterForNotes(item.teacherNotes)?.number === chapterNumber);
  const allowedTotal = paidAccess ? chapterRows.length : trialAccess ? Math.min(product.trialQuestions, chapterRows.length) : 0;
  const rows = canPractice ? chapterRows.slice(paidAccess ? (page - 1) * 10 : 0, paidAccess ? page * 10 : product.trialQuestions) : [];
  return Response.json({ items: rows.map((item) => ({ ...item, stem: removeAccountingPageFurniture(item.stem) ?? "", explanation: removeAccountingPageFurniture(item.explanation) ?? "" })), total: allowedTotal, bookTotal: allRows.length, chapterTotal: chapterRows.length, trialLimit: product.trialQuestions, paidAccess, trialAccess, hasWholeBook: auth.member.role === "admin" || Boolean(wholeEntitlement), expiresAt: (wholeEntitlement || chapterEntitlement)?.expiresAt ?? null }, { headers: { "cache-control": "no-store" } });
}
