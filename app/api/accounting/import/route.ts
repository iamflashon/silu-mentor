import { and, eq } from "drizzle-orm";
import { unzipSync } from "fflate";
import { extractText } from "unpdf";
import { getDb } from "../../../../db";
import { documents, examQuestions } from "../../../../db/schema";
import { accountingQuestionFlags, removeAccountingPageFurniture } from "../../../../lib/accounting-question";
import { inspectDocumentBytes } from "../../../../lib/document-processing";
import { requireAccountingAdmin } from "../../../../lib/member-auth";

type ParsedQuestion={number:string;stem:string;options:Record<string,string>;answer:string;explanation:string;teacherAnswer:string;chapter:string;examSource:string;page:number;examType:"mcq"|"essay"};

function clean(value:string){return removeAccountingPageFurniture(value).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/gu,"").replace(/[ \t]+/gu," ").replace(/ *\n */gu,"\n").replace(/\n{3,}/gu,"\n\n").trim()}
function normalize(value:string){return clean(value
  .replace(//gu,"(A)").replace(//gu,"(B)").replace(//gu,"(C)").replace(//gu,"(D)")
  .replace(/[（(]([A-D])[）)]/gu,"($1)")
  .replace(/[¯]\s*計算過程/gu,"\n【計算過程】\n")
  .replace(/[]/gu," ").replace(//gu,"×").replace(//gu,"=").replace(//gu,"+").replace(//gu,"÷").replace(//gu,"−"))}

function chapterOf(text:string){
 const matches=[...text.matchAll(/第\s*[一二三四五六七八九十百0-9]+\s*章[^\n]{0,45}/gu)];
 return clean(matches.at(-1)?.[0]??"");
}

function normalizeExamSource(value:string){
 const compact=clean(value).replace(/\s+/gu," ");
 return compact.replace(/^((?:10\d|11\d))(?!年)/u,"$1年");
}

function extractExamSource(text:string){
 const parenthesized=[...text.matchAll(/[（(]\s*((?:10\d|11\d)\s*年?\s*[^\n）)]{2,100})\s*[）)]/gu)];
 const candidate=parenthesized.at(-1)?.[1];
 if(candidate)return normalizeExamSource(candidate);
 return "";
}

function documentExamSource(fileName:string){
 const match=fileName.match(/((?:10\d|11\d)\s*年[^.]{2,120})\.(?:docx|pdf|txt)$/iu);
 return normalizeExamSource(match?.[1]??"");
}

function parseOptions(segment:string){
 const options:Record<string,string>={};
 for(const key of ["A","B","C","D"]){
  const marker=new RegExp(`(?:\\(${key}\\)|(?:^|\\n)\\s*${key}[.)])\\s*`,"iu"); const found=marker.exec(segment); const start=found?.index??-1; if(start<0)continue;
  const markerLength=found?.[0].length??3;
  const nextKey=String.fromCharCode(key.charCodeAt(0)+1);
  const next=key==="D"?-1:(()=>{const nextMatch=new RegExp(`(?:\\(${nextKey}\\)|(?:^|\\n)\\s*${nextKey}[.)])\\s*`,"iu").exec(segment.slice(start+markerLength));return nextMatch?start+markerLength+nextMatch.index:-1})();
  let end=next>=0?next:segment.length;
  if(key==="D"){
   const tail=segment.slice(start);
   const sourceOffset=tail.search(/\n\s*[（(]\d{2,3}(?:年)?[^\n）)]{2,100}[）)]/u);
   const calculationOffset=tail.search(/(?:【\s*(?:計算過程|解答|解析)\s*】|\n\s*(?:計算過程|解答|解析)\s*[：:]?)/u);
   const stops=[
    calculationOffset>=0?start+calculationOffset:-1,
    sourceOffset>=0?start+sourceOffset:-1,
   ].filter(v=>v>=0);
   if(stops.length)end=Math.min(...stops);
  }
  options[key]=clean(segment.slice(start+markerLength,end).replace(/\n\s*\([A-D]\)\s*$/u,""));
 }
 return options;
}

function xmlText(value:string){
 return value.replace(/<w:tab\b[^>]*\/>/giu,"\t").replace(/<w:br\b[^>]*\/>/giu,"\n").replace(/<\/w:p>/giu,"\n").replace(/<\/w:tc>/giu,"\n").replace(/<[^>]+>/gu,"").replace(/&lt;/gu,"<").replace(/&gt;/gu,">").replace(/&amp;/gu,"&").replace(/&quot;/gu,'"').replace(/&#39;|&apos;/gu,"'");
}

function parseWordTableQuestions(bytes:Uint8Array):ParsedQuestion[]{
 let entries:Record<string,Uint8Array>;
 try{entries=unzipSync(bytes)}catch{return []}
 const source=entries["word/document.xml"]?new TextDecoder().decode(entries["word/document.xml"]):"";
 if(!source)return [];
 const tables=source.match(/<w:tbl\b[\s\S]*?<\/w:tbl>/giu)??[];
 const result:ParsedQuestion[]=[];
 for(const table of tables){
  const rows=table.match(/<w:tr\b[\s\S]*?<\/w:tr>/giu)??[];
  for(const row of rows){
   const cells=row.match(/<w:tc\b[\s\S]*?<\/w:tc>/giu)??[]; if(!cells.length)continue;
   const raw=clean(xmlText(cells[0])); if(raw.length<18)continue;
   const answerCell=clean(xmlText(cells[1]??""));
   const answer=(answerCell.match(/(?:^|\s)[(（]?\s*([A-Da-d])\s*[)）]?\s*$/u)?.[1]??"").toUpperCase();
   const options=parseOptions(raw);
   const beforeAnswer=raw.split(/(?:【\s*(?:解答|解析)\s*】|計算過程)/u)[0];
   const stemEnd=Math.min(...[beforeAnswer.indexOf("(A)"),beforeAnswer.search(/(?:^|\n)\s*[Aa][.)]\s*/u)].filter((value)=>value>=0),beforeAnswer.length);
   const stem=clean(beforeAnswer.slice(0,stemEnd));
   if(stem.length<12)continue;
   const hasQuestionMark=/[?？]/u.test(stem),hasOptions=Object.keys(options).length>=2;
   if(!answer&&!hasOptions&&!hasQuestionMark)continue;
   const calc=raw.search(/【\s*(?:解答|解析)\s*】|計算過程/u);
   const explanation=calc>=0?clean(raw.slice(calc).replace(/^.*?(?:【\s*(?:解答|解析)\s*】|計算過程)/u,"")):"";
   result.push({number:String(result.length+1),stem,options,answer,explanation,teacherAnswer:explanation,chapter:chapterOf(raw),examSource:extractExamSource(raw),page:1,examType:hasOptions||answer?"mcq":"essay"});
  }
 }
 return result;
}

function parseQuestions(pages:string[],documentType:string){
  const joined=pages.map((page,index)=>`\n[[PAGE:${index+1}]]\n${normalize(page)}`).join("\n");
  const starts=[...joined.matchAll(/(?:^|\n)\s*(\d{1,3})[.、]\s*(?=\S)/gu)];
  const pageMarkers=[...joined.matchAll(/\[\[PAGE:(\d+)\]\]/gu)];
  const parsed:ParsedQuestion[]=[];
  let pageIndex=0;
 for(let index=0;index<starts.length;index++){
  const match=starts[index]; const from=(match.index??0)+match[0].lastIndexOf(match[1]); const to=starts[index+1]?.index??joined.length;
  const raw=clean(joined.slice(from,to).replace(/^\d{1,3}[.、]\s*/u,""));
  if(raw.length<18)continue;
  while(pageIndex+1<pageMarkers.length&&(pageMarkers[pageIndex+1].index??0)<from)pageIndex++;
  const page=Number(pageMarkers[pageIndex]?.[1]??1);
  const pagePrefix=normalize(pages[Math.max(0,page-1)]??"");
  const chapter=chapterOf(pagePrefix)||chapterOf(raw);
  const examSource=extractExamSource(raw);
  const options=parseOptions(raw);
  const completeOptions=["A","B","C","D"].every(key=>Boolean(options[key]));
  const forcedEssay=documentType==="申論題庫";
  const examType:ParsedQuestion["examType"]=!forcedEssay&&completeOptions?"mcq":"essay";
  const firstOption=raw.indexOf("(A)");
  const answerMatches=[...raw.matchAll(/(?:^|\n)\s*\(([A-D])\)\s*(?=\n|$)/gu)];
  const answer=answerMatches.at(-1)?.[1]??"";
  const calculationMatch=raw.match(/(?:【\s*(?:計算過程|解答|解析)\s*】|(?:^|\n)\s*(?:計算過程|解答|解析)\s*[：:]?)/u);
  const calculation=calculationMatch?.index??-1;
  const answerLabel=raw.search(/【解答】|(?:^|\n)\s*解答[：:]?/u);
  const stemEnd=firstOption>=0?firstOption:answerLabel>=0?answerLabel:raw.length;
  const stem=clean(raw.slice(0,stemEnd).replace(/\[\[PAGE:\d+\]\]/gu,""));
  const explanation=calculation>=0?clean(raw.slice(calculation).replace(/^\s*(?:【\s*(?:計算過程|解答|解析)\s*】|計算過程|解答[：:]?|解析[：:]?)/u,"").replace(/\[\[PAGE:\d+\]\]/gu,"").replace(/\n\s*\([A-D]\)\s*$/u,"")):"";
  const teacherAnswer=answerLabel>=0?clean(raw.slice(answerLabel).replace(/^【?解答】?[：:]?/u,"").replace(/\[\[PAGE:\d+\]\]/gu,"")):explanation;
  if(stem.length<12)continue;
  parsed.push({number:match[1],stem,options,answer,explanation,teacherAnswer,chapter,examSource,page,examType});
 }
 return parsed;
}

function parseGroupedWordQuestions(text:string):ParsedQuestion[]{
  const markers=[...text.matchAll(/【\s*(?:解答|解析)\s*】/gu)];
  if(!markers.length)return [];
  const starts=[...text.matchAll(/(?:^|\n)\s*(?:\d{1,3}[.、]\s*|(?:甲|乙|丙|丁|戊|己|庚|辛|壬|癸)?[\u4e00-\u9fff]{1,10}公司\s*(?=[X\d一二三四五六七八九十]|於|本期|年度))/gu)].map(match=>(match.index??0)+(match[0].startsWith("\n")?1:0));
  const result:ParsedQuestion[]=[];
  for(let index=0;index<markers.length;index++){
    const marker=markers[index], previousEnd=index?markerPositionEnd(markers[index-1]):0;
    const blockStart=starts.find(position=>position>=previousEnd&&position<=(marker.index??0));
    if(blockStart===undefined)continue;
    const blockEnd=marker.index??text.length;
    const nextStart=starts.find(position=>position>blockEnd)??(index+1<markers.length?markers[index+1].index??text.length:text.length);
    const stem=clean(text.slice(blockStart,blockEnd));
    const teacherAnswer=clean(text.slice(markerPositionEnd(marker),nextStart));
    if(stem.length<20)continue;
    result.push({number:String(index+1),stem,options:{},answer:"",explanation:teacherAnswer,teacherAnswer,chapter:"",examSource:"",page:1,examType:"essay"});
  }
  return result;
}
function markerPositionEnd(match:RegExpMatchArray){return (match.index??0)+match[0].length;}

export async function POST(request:Request){
 try{
  const auth=await requireAccountingAdmin(request);if("error" in auth)return auth.error;
  const body=await request.json() as {documentId?:number;offset?:number;limit?:number};
  const documentId=Number(body.documentId),offset=Math.max(0,Math.floor(Number(body.offset)||0)),limit=Math.min(80,Math.max(10,Math.floor(Number(body.limit)||60)));
  const db=await getDb();
  const [document]=await db.select().from(documents).where(and(eq(documents.id,documentId),eq(documents.examCategory,"accounting"))).limit(1);
  if(!document)return Response.json({error:"找不到中會教材"},{status:404});
  const inferredType=/51MM320901|會研所.*題庫制霸/u.test(document.fileName)?"章節題庫":/51MG123611|申論題完全制霸/u.test(document.fileName)?"申論題庫":/51MG122110|114年解題全攻略/u.test(document.fileName)?"年度解題":document.documentType;
  if(inferredType!==document.documentType)await db.update(documents).set({documentType:inferredType,subject:"中級會計學"}).where(eq(documents.id,documentId));
  const {env}=await import("cloudflare:workers"); const object=await env.BUCKET?.get(document.storageKey);
  if(!object)return Response.json({error:"找不到教材原始檔"},{status:404});
  await db.update(documents).set({status:"extracting",processingStage:"extracting",processingMessage:offset?`正在分批入庫：已處理 ${offset} 題`:"正在逐頁讀取完整題目"}).where(eq(documents.id,documentId));
  const bytes=new Uint8Array(await object.arrayBuffer());
  const isWordQuiz=/\.docx$/iu.test(document.fileName)&&/(?:小考|模擬考|考題|題庫|測驗)/u.test(document.fileName);
  let pages:string[]=[];let totalPages=1;
  if(/\.pdf$/iu.test(document.fileName)){const extracted=await extractText(bytes,{mergePages:false});pages=Array.isArray(extracted.text)?extracted.text:[String(extracted.text)];totalPages=extracted.totalPages??pages.length}else{const inspected=await inspectDocumentBytes(document.fileName,bytes.buffer as ArrayBuffer);pages=[inspected.text]}
  const parsed=parseQuestions(pages,inferredType);const wordTable=isWordQuiz?parseWordTableQuestions(bytes):[];const grouped=isWordQuiz?parseGroupedWordQuestions(pages.join("\n")):[];const questions=wordTable.length?wordTable:(grouped.length>parsed.length?grouped:parsed);const documentSource=documentExamSource(document.fileName);
  if(!questions.length)throw new Error("未辨識到可入庫的完整題目");
  const sourceUrl=`document:${document.id}`;
  if(offset===0)await db.delete(examQuestions).where(and(eq(examQuestions.examCategory,"accounting"),eq(examQuestions.sourceUrl,sourceUrl)));
  let imported=0;
  for(const question of questions.slice(offset,offset+limit)){
   try{const flags=accountingQuestionFlags(question.stem);await db.insert(examQuestions).values({examCategory:"accounting",examType:question.examType,year:question.examSource||documentSource||(inferredType==="年度解題"?"114年度考題":"未標示考試來源"),examName:inferredType,subject:"中級會計學",questionNumber:question.number,stem:removeAccountingPageFurniture(question.stem),optionsJson:question.examType==="mcq"?JSON.stringify(question.options):null,correctAnswer:question.answer||null,explanation:removeAccountingPageFurniture(question.explanation),teacherAnswer:question.examType==="essay"?removeAccountingPageFurniture(question.teacherAnswer):"",teacherNotes:[question.examSource?`考試來源：${question.examSource}`:"",question.chapter,`原稿第 ${question.page} 頁`,flags.needsTableReview?"HTML表格呈現":"",flags.brokenGlyphs?"缺字待核對":""].filter(Boolean).join("｜"),answerSource:question.answer||question.teacherAnswer?"上傳教材原稿":"",answerStatus:question.answer||question.teacherAnswer?"source_matched":"missing",sourceUrl,status:"draft"});imported++}catch{/* continue remaining */}
  }
  const nextOffset=Math.min(questions.length,offset+limit),done=nextOffset>=questions.length;
  const mcq=questions.filter(q=>q.examType==="mcq").length,essay=questions.length-mcq,missingAnswer=questions.filter(q=>q.examType==="mcq"&&!q.answer).length;
  await db.update(documents).set({status:done?"completed":"extracting",processingStage:done?"completed":"extracting",processingMessage:done?`逐頁拆解完成：${questions.length} 題（選擇 ${mcq}、申論／計算 ${essay}）已進入待審核題庫`:`正在分批入庫：${nextOffset} / ${questions.length} 題`,pageCount:totalPages,questionCount:questions.length,processedAt:done?new Date():null,indexError:null}).where(eq(documents.id,documentId));
  return Response.json({status:done?"completed":"importing",documentId,parsed:questions.length,imported,offset,nextOffset,done,stats:{mcq,essay,missingAnswer,pages:totalPages},message:done?`拆解完成，共 ${questions.length} 題`: `已入庫 ${nextOffset} / ${questions.length} 題`},{status:done?200:202});
 }catch(error){return Response.json({error:error instanceof Error?error.message:"中會題庫拆解失敗",status:"failed"},{status:500})}
}
