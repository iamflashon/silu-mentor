import { and, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "../../../db";
import { legalArticles, legalDocuments } from "../../../db/schema";

const examLaws = [
  "中華民國憲法",
  "中華民國刑法",
  "刑事訴訟法",
  "民法",
  "民事訴訟法",
  "行政程序法",
  "行政訴訟法",
  "公司法",
  "證券交易法",
  "保險法",
  "票據法",
];

const subjectLaws: Record<string, string[]> = {
  刑法: ["中華民國刑法"],
  刑事訴訟法: ["刑事訴訟法"],
  民法: ["民法"],
  民事訴訟法: ["民事訴訟法"],
  憲法: ["中華民國憲法"],
  行政法: ["行政程序法", "行政訴訟法"],
  商事法: ["公司法", "證券交易法", "保險法", "票據法"],
};

async function randomArticle(coreOnly: boolean, subject = "") {
  const db = await getDb();
  const conditions = [
    eq(legalDocuments.status, "active"),
    eq(legalDocuments.category, "法律"),
  ];
  const selectedLaws = subjectLaws[subject];
  if (selectedLaws?.length) conditions.push(inArray(legalDocuments.title, selectedLaws));
  else if (coreOnly) conditions.push(inArray(legalDocuments.title, examLaws));
  const rows = await db
    .select({
      documentId: legalDocuments.id,
      title: legalDocuments.title,
      articleNo: legalArticles.articleNo,
      hierarchy: legalArticles.hierarchy,
      content: legalArticles.content,
    })
    .from(legalArticles)
    .innerJoin(legalDocuments, eq(legalArticles.documentId, legalDocuments.id))
    .where(and(...conditions))
    .orderBy(sql`random()`)
    .limit(80);

  return rows.filter((article) => isLearnableArticle(article.content)).slice(0, 1);
}

function isLearnableArticle(content: string) {
  const marker = content
    .replace(/[\s\u3000]/g, "")
    .replace(/[（）()【】〔〕［］\[\]。．.：:；;]/g, "");
  if (!marker) return false;
  return !/^(?:本條)?(?:業經|已)?(?:刪除|廢止|失效|停止適用)$/.test(marker);
}

export async function GET(request: Request) {
  try {
    const subject = new URL(request.url).searchParams.get("subject") ?? "";
    if (!subjectLaws[subject]) return Response.json({ article: null, message: "選擇今日考科後才會推薦法條。" });
    const rows = await randomArticle(true, subject);
    const fallback = rows.length ? rows : await randomArticle(false, subject);
    const article = fallback[0] ?? null;
    return Response.json({ article, message: article ? "" : "全國法規完成匯入後，這裡會隨機出現法條。" });
  } catch {
    return Response.json({ article: null, message: "法規資料尚未就緒" });
  }
}
