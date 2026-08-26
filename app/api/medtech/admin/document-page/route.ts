import { and, eq } from "drizzle-orm";
import { getDb } from "../../../../../db";
import { documents, examQuestions } from "../../../../../db/schema";
import { requireMedtechQuestionEditor } from "../../../../../lib/member-auth";

function normalize(value:string){return value.replace(/<[^>]*>/gu," ").replace(/[\s，。；：、（）()？?．·\-]/gu,"").toLowerCase()}

export async function GET(request:Request){
 const auth=await requireMedtechQuestionEditor(request);if("error" in auth)return auth.error;
 const url=new URL(request.url),documentId=Number(url.searchParams.get("documentId")),questionId=Number(url.searchParams.get("questionId"));
 const db=await getDb();
 const [[document],questions]=await Promise.all([
  db.select().from(documents).where(and(eq(documents.id,documentId),eq(documents.examCategory,"medtech"))).limit(1),
  db.select({id:examQuestions.id,stem:examQuestions.stem,sourceUrl:examQuestions.sourceUrl}).from(examQuestions).where(and(eq(examQuestions.examCategory,"medtech"),eq(examQuestions.sourceUrl,`document:${documentId}`))),
 ]);
 const question=questions.find(item=>item.id===questionId);
 if(!document||(questionId>0&&!question))return Response.json({error:"找不到題目或原稿"},{status:404});
 if(!/\.pdf$/iu.test(document.fileName))return Response.json({page:1,matched:false});
 const {env}=await import("cloudflare:workers");const object=await env.BUCKET?.get(document.storageKey);if(!object)return Response.json({error:"找不到原稿"},{status:404});
 const {extractText}=await import("unpdf");const extracted=await extractText(new Uint8Array(await object.arrayBuffer()),{mergePages:false});
 const pages=Array.isArray(extracted.text)?extracted.text:[extracted.text],normalizedPages=pages.map(normalize);
 const locate=(stem:string)=>{const normalized=normalize(stem),needle=normalized.slice(0,36);let page=normalizedPages.findIndex(text=>text.includes(needle));if(page<0){const fragments=normalized.match(/.{10,18}/gu)??[];page=normalizedPages.findIndex(text=>fragments.some(fragment=>text.includes(fragment)))}return page};
 if(!questionId)return Response.json({pageCount:pages.length,mappings:questions.map(item=>{const page=locate(item.stem);return {questionId:item.id,page:page<0?null:page+1,matched:page>=0}})});
 const page=locate(question!.stem);
 return Response.json({page:page<0?1:page+1,matched:page>=0});
}
