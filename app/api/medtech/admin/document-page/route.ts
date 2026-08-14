import { and, eq } from "drizzle-orm";
import { getDb } from "../../../../../db";
import { documents, examQuestions } from "../../../../../db/schema";
import { requireMedtechAdmin } from "../../../../../lib/member-auth";

function normalize(value:string){return value.replace(/<[^>]*>/gu," ").replace(/[\s，。；：、（）()？?．·\-]/gu,"").toLowerCase()}

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
 const {env}=await import("cloudflare:workers");const object=await env.BUCKET?.get(document.storageKey);if(!object)return Response.json({error:"找不到原稿"},{status:404});
 const {extractText}=await import("unpdf");const extracted=await extractText(new Uint8Array(await object.arrayBuffer()),{mergePages:false});
 const pages=Array.isArray(extracted.text)?extracted.text:[extracted.text];const needle=normalize(question.stem).slice(0,36);
 let page=pages.findIndex(text=>normalize(text).includes(needle));
 if(page<0){const fragments=normalize(question.stem).match(/.{10,18}/gu)??[];page=pages.findIndex(text=>{const haystack=normalize(text);return fragments.some(fragment=>haystack.includes(fragment))})}
 return Response.json({page:page<0?1:page+1,matched:page>=0});
}
