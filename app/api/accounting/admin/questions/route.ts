import { and, asc, desc, eq, like, or, sql } from "drizzle-orm";
import { getDb } from "../../../../../db";
import { documents, examQuestions } from "../../../../../db/schema";
import { requireAccountingAdmin } from "../../../../../lib/member-auth";
import { removeAccountingPageFurniture } from "../../../../../lib/accounting-question";
import { sanitizeRichHtml } from "../../../../../lib/rich-html";

function repairQualityText(value:string,kind:"spacing"|"linebreak"){
  const source=String(value||"");
  if(kind==="linebreak")return source.replace(/([\u4e00-\u9fff])(?:\s*<br\s*\/?\s*>\s*|\r?\n\s*)(?=[\u4e00-\u9fff])/giu,"$1");
  return source.split(/(<[^>]+>)/g).map(part=>part.startsWith("<")?part:part.replace(/([\u4e00-\u9fff])\s+(?=[\u4e00-\u9fffA-Za-z0-9$％%])/gu,"$1").replace(/([A-Za-z0-9])\s+(?=[\u4e00-\u9fff])/gu,"$1").replace(/([，。；：、（）])\s+(?=[\u4e00-\u9fffA-Za-z0-9])/gu,"$1")).join("");
}

function present(item:typeof examQuestions.$inferSelect){
  return {...item,stem:removeAccountingPageFurniture(item.stem),explanation:removeAccountingPageFurniture(item.explanation),teacherAnswer:removeAccountingPageFurniture(item.teacherAnswer),options:JSON.parse(item.optionsJson||"{}")};
}

export async function GET(request:Request){
  const auth=await requireAccountingAdmin(request);if("error" in auth)return auth.error;
  const url=new URL(request.url),requestedId=Number(url.searchParams.get("id"));
  const db=await getDb();
  if(Number.isInteger(requestedId)&&requestedId>0){
    const [item]=await db.select().from(examQuestions).where(and(eq(examQuestions.id,requestedId),eq(examQuestions.examCategory,"accounting"))).limit(1);
    return item?Response.json({item:present(item)}):Response.json({error:"找不到中會題目"},{status:404});
  }
  const documentId=Number(url.searchParams.get("documentId")),sourceOrder=url.searchParams.get("order")==="source",page=Math.max(1,Number(url.searchParams.get("page"))||1),limit=Math.min(100,Math.max(10,Number(url.searchParams.get("limit"))||30));
  const query=url.searchParams.get("query")?.trim()??"",year=url.searchParams.get("year")?.trim()??"",subject=url.searchParams.get("subject")?.trim()??"",status=url.searchParams.get("status")?.trim()??"";
  const filters=[eq(examQuestions.examCategory,"accounting"),...(query?[or(like(examQuestions.stem,"%"+query+"%"),like(examQuestions.explanation,"%"+query+"%"),like(examQuestions.teacherAnswer,"%"+query+"%"),like(examQuestions.questionNumber,"%"+query+"%"))!]:[]),...(year?[eq(examQuestions.year,year)]:[]),...(subject?[eq(examQuestions.subject,subject)]:[]),...(status?[eq(examQuestions.status,status)]:[]),...(Number.isInteger(documentId)&&documentId>0?[eq(examQuestions.sourceUrl,"document:"+documentId)]:[])];
  const where=and(...filters);
  const [countRow]=await db.select({total:sql<number>`count(*)`}).from(examQuestions).where(where);
  const [draftRow]=await db.select({total:sql<number>`count(*)`}).from(examQuestions).where(and(eq(examQuestions.examCategory,"accounting"),eq(examQuestions.status,"draft")));
  const items=await db.select().from(examQuestions).where(where).orderBy(sourceOrder&&documentId>0?asc(examQuestions.id):desc(examQuestions.id)).limit(limit).offset((page-1)*limit);
  const facets=await db.select({year:examQuestions.year,subject:examQuestions.subject}).from(examQuestions).where(eq(examQuestions.examCategory,"accounting"));
  return Response.json({items:items.map(present),total:Number(countRow?.total??0),draftTotal:Number(draftRow?.total??0),page,limit,years:[...new Set(facets.map(item=>item.year).filter(Boolean))].sort((a,b)=>b.localeCompare(a,"zh-Hant",{numeric:true})),subjects:[...new Set(facets.map(item=>item.subject).filter(Boolean))].sort()});
}

export async function PATCH(request:Request){
  const auth=await requireAccountingAdmin(request);if("error" in auth)return auth.error;
  const body=await request.json() as Record<string,unknown>,db=await getDb();
  const qualityRepair=body.qualityRepair==="spacing"||body.qualityRepair==="linebreak"?body.qualityRepair:null;
  if(qualityRepair){
    const documentId=Number(body.documentId);
    if(!Number.isInteger(documentId)||documentId<1)return Response.json({error:"缺少文件編號"},{status:400});
    const rows=await db.select().from(examQuestions).where(and(eq(examQuestions.examCategory,"accounting"),eq(examQuestions.sourceUrl,"document:"+documentId)));
    let updated=0;
    for(const row of rows){
      const options=JSON.parse(row.optionsJson||"{}") as Record<string,string>;
      const nextStem=repairQualityText(row.stem,qualityRepair),nextExplanation=repairQualityText(row.explanation,qualityRepair),nextTeacherAnswer=repairQualityText(row.teacherAnswer,qualityRepair),nextOptions=Object.fromEntries(Object.entries(options).map(([key,value])=>[key,repairQualityText(String(value??""),qualityRepair)]));
      if(nextStem===row.stem&&nextExplanation===row.explanation&&nextTeacherAnswer===row.teacherAnswer&&JSON.stringify(nextOptions)===JSON.stringify(options))continue;
      await db.update(examQuestions).set({stem:sanitizeRichHtml(nextStem),explanation:sanitizeRichHtml(nextExplanation),teacherAnswer:sanitizeRichHtml(nextTeacherAnswer),optionsJson:JSON.stringify(Object.fromEntries(Object.entries(nextOptions).map(([key,value])=>[key,sanitizeRichHtml(value)])))}).where(and(eq(examQuestions.id,row.id),eq(examQuestions.examCategory,"accounting")));
      updated+=1;
    }
    return Response.json({qualityRepair,updated,scanned:rows.length});
  }
  if(body.publishAllDrafts===true){
    const documentId=Number(body.documentId);
    if(!Number.isInteger(documentId)||documentId<1)return Response.json({error:"請從文件卡片按「發布此文件」，一次發布單一文件。"},{status:400});
    const [document]=await db.select({id:documents.id,storageKey:documents.storageKey,fileName:documents.fileName}).from(documents).where(and(eq(documents.id,documentId),eq(documents.examCategory,"accounting"))).limit(1);
    if(!document)return Response.json({error:"找不到指定的中會文件"},{status:404});
    const aliases=[...new Set([`document:${document.id}`,document.storageKey,document.fileName].filter((value):value is string=>Boolean(value)))];
    const sourceFilter=or(...aliases.map((source)=>eq(examQuestions.sourceUrl,source)));
    const draftRows=await db.select({id:examQuestions.id,teacherAnswer:examQuestions.teacherAnswer,correctAnswer:examQuestions.correctAnswer}).from(examQuestions).where(and(eq(examQuestions.examCategory,"accounting"),eq(examQuestions.status,"draft"),sourceFilter));
    const publishableRows=draftRows.filter((row)=>/^[A-D]$/i.test(String(row.teacherAnswer||row.correctAnswer||"").trim()));
    for(const row of publishableRows)await db.update(examQuestions).set({status:"published"}).where(and(eq(examQuestions.id,row.id),eq(examQuestions.examCategory,"accounting")));
    const rows=publishableRows;
    const skippedUnanswered=draftRows.filter((row)=>!/^[A-D]$/i.test(String(row.teacherAnswer||row.correctAnswer||"").trim())).length;
    if(!rows.length&&draftRows.length)return Response.json({error:`本文件尚未發布任何題目：${skippedUnanswered} 題尚未設定有效答案。`,updated:0,skippedUnanswered,status:"draft"},{status:409});
    return Response.json({updated:rows.length,skippedUnanswered,skipped:Math.max(0,draftRows.length-rows.length),documentId,status:"published"});
  }
  const replaceFind=typeof body.replaceFind==="string"?body.replaceFind:"";
  if(replaceFind){
    const documentId=Number(body.documentId),replacement=typeof body.replaceWith==="string"?body.replaceWith:"";
    if(!Number.isInteger(documentId)||documentId<1)return Response.json({error:"缺少文件編號"},{status:400});
    if(replaceFind.length>2000||replacement.length>4000)return Response.json({error:"搜尋或取代文字過長"},{status:400});
    const rows=await db.select().from(examQuestions).where(and(eq(examQuestions.examCategory,"accounting"),eq(examQuestions.sourceUrl,"document:"+documentId)));
    let matched=0;
    for(const row of rows){
      const options=JSON.parse(row.optionsJson||"{}") as Record<string,string>,replace=(value:string)=>value.split(replaceFind).join(replacement);
      const nextStem=replace(row.stem),nextExplanation=replace(row.explanation),nextTeacherAnswer=replace(row.teacherAnswer),nextOptions=Object.fromEntries(Object.entries(options).map(([key,value])=>[key,replace(String(value??""))]));
      if(nextStem===row.stem&&nextExplanation===row.explanation&&nextTeacherAnswer===row.teacherAnswer&&JSON.stringify(nextOptions)===JSON.stringify(options))continue;
      matched+=1;await db.update(examQuestions).set({stem:sanitizeRichHtml(nextStem),explanation:sanitizeRichHtml(nextExplanation),teacherAnswer:sanitizeRichHtml(nextTeacherAnswer),optionsJson:JSON.stringify(Object.fromEntries(Object.entries(nextOptions).map(([key,value])=>[key,sanitizeRichHtml(value)])))}).where(eq(examQuestions.id,row.id));
    }
    return Response.json({replaced:true,matched,updated:matched});
  }
  const id=Number(body.id);
  const [existing]=await db.select({id:examQuestions.id}).from(examQuestions).where(and(eq(examQuestions.id,id),eq(examQuestions.examCategory,"accounting"))).limit(1);
  if(!existing)return Response.json({error:"找不到中會題目"},{status:404});
  const allowed=["year","subject","questionNumber","stem","correctAnswer","explanation","teacherAnswer","teacherNotes","answerSource","status"] as const,values:Record<string,string>={};
  for(const key of allowed)if(typeof body[key]==="string")values[key]=["stem","explanation","teacherAnswer"].includes(key)?sanitizeRichHtml(String(body[key]).trim()):String(body[key]).trim();
  if(body.options&&typeof body.options==="object")values.optionsJson=JSON.stringify(Object.fromEntries(Object.entries(body.options).map(([key,value])=>[key,sanitizeRichHtml(String(value))])));
  await db.update(examQuestions).set(values).where(eq(examQuestions.id,id));
  return Response.json({updated:true});
}

export async function DELETE(request:Request){
  const auth=await requireAccountingAdmin(request);if("error" in auth)return auth.error;
  const {id}=await request.json() as {id?:number},db=await getDb();
  await db.delete(examQuestions).where(and(eq(examQuestions.id,Number(id)),eq(examQuestions.examCategory,"accounting")));
  return Response.json({deleted:true});
}
