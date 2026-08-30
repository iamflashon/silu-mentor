import { and, asc, count, eq, inArray, like, or } from "drizzle-orm";
import { accountingMemberEntitlements, documents, examQuestions } from "../../../../db/schema";
import { requireMember } from "../../../../lib/member-auth";
import { ACCOUNTING_FIRST_PRODUCT_KEY, ACCOUNTING_FIRST_PRODUCT_TITLE, getAccountingProductSettings } from "../../../../lib/accounting-product-settings";
import { removeAccountingPageFurniture } from "../../../../lib/accounting-question";

export async function GET(request: Request) {
  const auth = await requireMember(request); if ("error" in auth) return auth.error;
  const url = new URL(request.url), page = Math.max(1, Number(url.searchParams.get("page") || 1)), chapter = url.searchParams.get("chapter")?.trim() ?? "", chapterNumber = Math.max(1, Math.min(18, Math.floor(Number(url.searchParams.get("chapterNumber") || 1))));
  const product = await getAccountingProductSettings(auth.db), now = new Date();
  const entitlements = await auth.db.select().from(accountingMemberEntitlements).where(and(eq(accountingMemberEntitlements.memberId, auth.member.id), eq(accountingMemberEntitlements.status, "active")));
  const wholeEntitlement = entitlements.find((item) => item.productKey === ACCOUNTING_FIRST_PRODUCT_KEY && item.expiresAt > now), chapterEntitlement = entitlements.find((item) => item.productKey === `${ACCOUNTING_FIRST_PRODUCT_KEY}:chapter:${chapterNumber}` && item.expiresAt > now);
  const paidAccess = auth.member.role === "admin" || Boolean(wholeEntitlement || chapterEntitlement), trialAccess = chapterNumber === 1, canPractice = paidAccess || trialAccess;
  const docs = await auth.db.select({ id: documents.id }).from(documents).where(like(documents.bookTitle, `%${ACCOUNTING_FIRST_PRODUCT_TITLE}%`));
  const sources = docs.map((row) => `document:${row.id}`);
  const baseWhere = sources.length ? and(inArray(examQuestions.sourceUrl, sources), eq(examQuestions.status, "published"), eq(examQuestions.examCategory, "accounting"), eq(examQuestions.examType, "mcq")) : eq(examQuestions.id, -1);
  const chapterTitle = chapter.replace(/^第[^章]+章\s*/u, ""); const where = chapter ? and(baseWhere, or(like(examQuestions.teacherNotes, `%第${chapterNumber}章%`), like(examQuestions.teacherNotes, `%${chapterTitle}%`))) : baseWhere;
  const [bookTotals, chapterTotals, rows] = await Promise.all([auth.db.select({ value: count() }).from(examQuestions).where(baseWhere), auth.db.select({ value: count() }).from(examQuestions).where(where), canPractice ? auth.db.select().from(examQuestions).where(where).orderBy(asc(examQuestions.id)).limit(paidAccess ? 10 : product.trialQuestions).offset(paidAccess ? (page - 1) * 10 : 0) : Promise.resolve([])]);
  return Response.json({ items: rows.map((item) => ({ ...item, stem: removeAccountingPageFurniture(item.stem) ?? "", explanation: removeAccountingPageFurniture(item.explanation) ?? "" })), total: paidAccess ? Number(chapterTotals[0]?.value ?? 0) : trialAccess ? Math.min(product.trialQuestions, Number(chapterTotals[0]?.value ?? 0)) : 0, bookTotal: Number(bookTotals[0]?.value ?? 0), chapterTotal: Number(chapterTotals[0]?.value ?? 0), trialLimit: product.trialQuestions, paidAccess, trialAccess, hasWholeBook: auth.member.role === "admin" || Boolean(wholeEntitlement), expiresAt: (wholeEntitlement || chapterEntitlement)?.expiresAt ?? null }, { headers: { "cache-control": "no-store" } });
}
