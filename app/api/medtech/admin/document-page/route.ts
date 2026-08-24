import { and, eq, like } from "drizzle-orm";
import { getDb } from "../../../../../db";
import { documentSearchUnits, documents, examQuestions } from "../../../../../db/schema";
import { requireMedtechAdmin } from "../../../../../lib/member-auth";

function searchFragments(value:string){
 const plain=value.normalize("NFKC").replace(/<[^>]*>/gu," ").replace(/\s+/gu," ").trim().toLocaleLowerCase("zh-Hant");
 return [...new Set(plain.split(/[，。；：、（）()？?．·]/gu).map(item=>item.trim()).filter(item=>item.length>=8).map(item=>item.slice(0,24)))].slice(0,4);
}

export async function GET(request:Request){
 const auth=await requireMedtechAdmin(request);if("error" in auth)return auth.error;
 const url=new URL(request.url),documentId=Number(url.searchParams.get("documentId")),questionId=Number(url.searchParams.get("questionId"));
 const db=await getDb();
 const [[document],[question]]=await Promise.all([
  db.select().from(documents).where(and(eq(documents.id,documentId),eq(documents.examCategory,"medtech"))).limit(1),
  db.select({stem:examQuestions.stem,sourceUrl:examQuestions.sourceUrl}).from(examQuestions).where(and(eq(examQuestions.id,questionId),eq(examQuestions.examCategory,"medtech"))).limit(1),
 ]);
 if(!document||!question||question.sourceUrl!==`document:${documentId}`)return Response.json({error:"找不到題目或原稿"},{status:404});
 if(!/\.pdf$/iu.test(document.fileName))return Response.json({page:1,matched:false});
 // Never parse the whole PDF during an interactive request. Large PDFs can
 // exceed the Worker's CPU/memory limits. Reuse the resumable page index and
 // fall back to page 1 when the document has not been indexed yet.
 for(const fragment of searchFragments(question.stem)){
  const [unit]=await db.select({page:documentSearchUnits.pageStart}).from(documentSearchUnits)
   .where(and(eq(documentSearchUnits.documentId,documentId),like(documentSearchUnits.normalizedText,`%${fragment}%`))).limit(1);
  const page=Number(unit?.page||0);if(page>0)return Response.json({page,matched:true});
 }
 return Response.json({page:1,matched:false});
}
