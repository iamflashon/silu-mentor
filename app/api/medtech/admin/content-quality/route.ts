import { and, eq } from "drizzle-orm";
import { getDb } from "../../../../../db";
import { documents, examQuestions } from "../../../../../db/schema";
import { requireMedtechAdmin } from "../../../../../lib/member-auth";
import { normalizeKnownPdfSymbols, scanMedtechQuestion } from "../../../../../lib/medtech-content-quality";

function safeOptions(value:string){ try{return JSON.parse(value||"{}") as Record<string,string>}catch{return {}} }
function applyFix(value:string){ return normalizeKnownPdfSymbols(String(value??"")); }

export async function GET(request:Request){
  const auth=await requireMedtechAdmin(request); if("error" in auth)return auth.error;
  const url=new URL(request.url); const documentId=Number(url.searchParams.get("documentId"));
  const db=await getDb();
  const docs=await db.select({id:documents.id,fileName:documents.fileName,subject:documents.subject,questionCount:documents.questionCount}).from(documents).where(eq(documents.examCategory,"medtech"));
  const docById=new Map(docs.map(doc=>[doc.id,doc]));
  const rows=await db.select().from(examQuestions).where(and(eq(examQuestions.examCategory,"medtech"),...(Number.isInteger(documentId)&&documentId>0?[eq(examQuestions.sourceUrl,`document:${documentId}`)]:[]))).limit(4000);
  const items=rows.map(row=>{
    const options=safeOptions(row.optionsJson);
    const issues=scanMedtechQuestion({...row,options} as unknown as Record<string,unknown>);
    const sourceId=Number(String(row.sourceUrl||"").replace(/^document:/,""));
    return {id:row.id,documentId:sourceId,documentName:docById.get(sourceId)?.fileName||row.sourceUrl,year:row.year,subject:row.subject,questionNumber:row.questionNumber,issues};
  }).filter(item=>item.issues.length>0);
  const allIssues=items.flatMap(i=>i.issues);
  const summary={questionsScanned:rows.length,questionsWithIssues:items.length,p0:allIssues.filter(i=>i.severity==="P0").length,p1:allIssues.filter(i=>i.severity==="P1").length,autoFixable:allIssues.filter(i=>i.autoFixable).length};
  return Response.json({summary,items,documents:docs});
}

export async function POST(request:Request){
  const auth=await requireMedtechAdmin(request); if("error" in auth)return auth.error;
  const body=await request.json() as {questionIds?:number[];documentId?:number;dryRun?:boolean};
  const db=await getDb();
  let rows=await db.select().from(examQuestions).where(eq(examQuestions.examCategory,"medtech")).limit(4000);
  if(Array.isArray(body.questionIds)&&body.questionIds.length) rows=rows.filter(row=>body.questionIds!.includes(row.id));
  else if(Number.isInteger(body.documentId)&&Number(body.documentId)>0) rows=rows.filter(row=>row.sourceUrl===`document:${body.documentId}`);
  let changed=0; const previews:{id:number;before:string;after:string}[]=[];
  for(const row of rows){
    const options=safeOptions(row.optionsJson); const nextOptions=Object.fromEntries(Object.entries(options).map(([k,v])=>[k,applyFix(v)]));
    const nextStem=applyFix(row.stem); const nextExplanation=applyFix(row.explanation||""); const nextComplete=applyFix(row.completeExplanation||""); const nextTeacher=applyFix(row.teacherCompleteExplanation||""); const nextAi=applyFix(row.aiCompleteExplanation||"");
    const before=JSON.stringify({stem:row.stem,options,explanation:row.explanation,completeExplanation:row.completeExplanation,teacherCompleteExplanation:row.teacherCompleteExplanation,aiCompleteExplanation:row.aiCompleteExplanation});
    const after=JSON.stringify({stem:nextStem,options:nextOptions,explanation:nextExplanation,completeExplanation:nextComplete,teacherCompleteExplanation:nextTeacher,aiCompleteExplanation:nextAi});
    if(before===after)continue; changed+=1; previews.push({id:row.id,before,after});
    if(body.dryRun===true)continue;
    await db.update(examQuestions).set({stem:nextStem,optionsJson:JSON.stringify(nextOptions),explanation:nextExplanation,completeExplanation:nextComplete,teacherCompleteExplanation:nextTeacher,aiCompleteExplanation:nextAi}).where(eq(examQuestions.id,row.id));
  }
  return Response.json({changed,dryRun:body.dryRun===true,previews:previews.slice(0,30)});
}
