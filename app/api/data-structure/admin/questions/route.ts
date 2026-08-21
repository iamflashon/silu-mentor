import { and, asc, eq, sql } from "drizzle-orm";
import { getDb } from "../../../../../db";
import { documents, examQuestions } from "../../../../../db/schema";
import { requireAccountingAdmin } from "../../../../../lib/member-auth";
import { sanitizeRichHtml } from "../../../../../lib/rich-html";

function present(item:typeof examQuestions.$inferSelect){return {...item,options:JSON.parse(item.optionsJson||"{}")}}

async function materialize(documentId:number){
 const db=await getDb();
 const existing=await db.select({id:examQuestions.id}).from(examQuestions).where(and(eq(examQuestions.examCategory,"data-structure"),eq(examQuestions.sourceUrl,`document:${documentId}`))).limit(1);if(existing.length)return;
 const [doc]=await db.select().from(documents).where(and(eq(documents.id,documentId),eq(documents.examCategory,"data-structure"))).limit(1);if(!doc)return;
 let questions:Array<Record<string,unknown>>=[];try{const parsed=JSON.parse(doc.processingResultJson||"{}");questions=Array.isArray(parsed.questions)?parsed.questions:Array.isArray(parsed.analysis?.questions)?parsed.analysis.questions:[]}catch{return}
 for(const [index,question] of questions.entries()){
  const options=question.options&&typeof question.options==="object"?question.options as Record<string,string>:{};const hasOptions=["A","B","C","D"].some(key=>String(options[key]??"").trim());const typeText=`${question.content_type||""} ${question.title||""}`;const examType=hasOptions?"mcq":/申論/u.test(typeText)?"essay":/演算|計算|追蹤|走訪|排序|BFS|DFS/u.test(typeText)?"calculation":"short_answer";
  await db.insert(examQuestions).values({examCategory:"data-structure",examType,year:String(question.year||"題庫"),examName:doc.documentType,subject:doc.subject,questionNumber:String(question.number||index+1),stem:String(question.title||""),optionsJson:hasOptions?JSON.stringify(options):null,correctAnswer:String(question.correct_answer||"").replace(/[()（）\s]/g,"").slice(0,1).toUpperCase()||null,explanation:String(question.explanation||""),teacherAnswer:String(question.teacher_answer||""),teacherNotes:String(question.chapter||""),answerSource:question.correct_answer||question.teacher_answer?"上傳教材原稿":"",answerStatus:question.correct_answer||question.teacher_answer?"source_matched":"missing",sourceUrl:`document:${documentId}`,status:"draft"}).catch(()=>undefined);
 }
}

export async function GET(request:Request){
 const auth=await requireAccountingAdmin(request);if("error" in auth)return auth.error;
 const url=new URL(request.url),documentId=Number(url.searchParams.get("documentId")),page=Math.max(1,Number(url.searchParams.get("page"))||1),limit=Math.min(100,Math.max(10,Number(url.searchParams.get("limit"))||100));
 if(documentId>0)await materialize(documentId);
 const db=await getDb(),where=and(eq(examQuestions.examCategory,"data-structure"),...(documentId>0?[eq(examQuestions.sourceUrl,`document:${documentId}`)]:[]));
 const [count]=await db.select({total:sql<number>`count(*)`}).from(examQuestions).where(where);
 const items=await db.select().from(examQuestions).where(where).orderBy(asc(examQuestions.id)).limit(limit).offset((page-1)*limit);
 return Response.json({items:items.map(present),total:Number(count?.total??0),page,limit});
}

export async function PATCH(request:Request){
 const auth=await requireAccountingAdmin(request);if("error" in auth)return auth.error;
 const body=await request.json() as Record<string,unknown>,id=Number(body.id),db=await getDb();
 const [existing]=await db.select({id:examQuestions.id}).from(examQuestions).where(and(eq(examQuestions.id,id),eq(examQuestions.examCategory,"data-structure"))).limit(1);
 if(!existing)return Response.json({error:"找不到資料結構題目"},{status:404});
 const allowed=["examType","year","subject","questionNumber","stem","correctAnswer","explanation","teacherAnswer","teacherNotes","answerSource","status"] as const,values:Record<string,string>={};
 for(const key of allowed)if(typeof body[key]==="string")values[key]=["stem","explanation","teacherAnswer"].includes(key)?sanitizeRichHtml(String(body[key]).trim()):String(body[key]).trim();
 if(body.options&&typeof body.options==="object")values.optionsJson=JSON.stringify(Object.fromEntries(Object.entries(body.options).map(([key,value])=>[key,sanitizeRichHtml(String(value))])));
 await db.update(examQuestions).set(values).where(eq(examQuestions.id,id));return Response.json({updated:true});
}
