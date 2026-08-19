import { and, eq } from "drizzle-orm";
import { getDb } from "../../../../../db";
import { documents, examQuestions } from "../../../../../db/schema";
import { requireAccountingAdmin } from "../../../../../lib/member-auth";
function normalize(value: string) { return value.replace(/<[^>]*>/gu, " ").replace(/[\s，。；：、（）()？?．·\-]/gu, "").toLowerCase(); }
export async function GET(request: Request) {
  const auth = await requireAccountingAdmin(request); if ("error" in auth) return auth.error;
  const url = new URL(request.url), documentId = Number(url.searchParams.get("documentId")), questionId = Number(url.searchParams.get("questionId")), db = await getDb();
  const [[doc], [question]] = await Promise.all([
    db.select().from(documents).where(and(eq(documents.id, documentId), eq(documents.examCategory, "accounting"))).limit(1),
    db.select({ stem: examQuestions.stem, sourceUrl: examQuestions.sourceUrl }).from(examQuestions).where(and(eq(examQuestions.id, questionId), eq(examQuestions.examCategory, "accounting"))).limit(1),
  ]);
  if (!doc || !question || question.sourceUrl !== `document:${documentId}`) return Response.json({ error: "找不到題目或原稿" }, { status: 404 });
  if (!/\.pdf$/iu.test(doc.fileName)) return Response.json({ page: 1, matched: false });
  const { env } = await import("cloudflare:workers"), object = await env.BUCKET.get(doc.storageKey);
  if (!object) return Response.json({ error: "找不到原稿" }, { status: 404 });
  const { extractText } = await import("unpdf"), extracted = await extractText(new Uint8Array(await object.arrayBuffer()), { mergePages: false }), pages = Array.isArray(extracted.text) ? extracted.text : [extracted.text], needle = normalize(question.stem).slice(0, 36);
  const page = pages.findIndex(text => normalize(text).includes(needle));
  return Response.json({ page: page < 0 ? 1 : page + 1, matched: page >= 0 });
}
