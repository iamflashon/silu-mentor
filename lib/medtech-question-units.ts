import { and, eq } from "drizzle-orm";
import type { getDb } from "../db";
import { documents, examQuestions } from "../db/schema";
import { MEDTECH_QUESTION_PACKAGE_SIZE } from "./medtech-usage";

export const MEDTECH_UNIT_TOPICS = ["臨床病毒學總論", "DNA 病毒", "RNA 病毒", "全真模擬試題"] as const;
export type MedtechQuestionUnit = { key:string; packageName:string; packNumber:number; questionIds:number[]; questionCount:number; label:string };

function topicOf(sourceName="",subject=""):(typeof MEDTECH_UNIT_TOPICS)[number]|null{const source=`${sourceName} ${subject}`;if(/全真模擬|模擬試題/iu.test(source))return"全真模擬試題";if(/DNA\s*病毒/iu.test(source))return"DNA 病毒";if(/RNA\s*病毒/iu.test(source))return"RNA 病毒";if(/臨床病毒學.*總論|總論.*臨床病毒學/iu.test(source))return"臨床病毒學總論";return null}
function stableHash(value:string){let hash=2166136261;for(let i=0;i<value.length;i++){hash^=value.charCodeAt(i);hash=Math.imul(hash,16777619)}return hash>>>0}
function stableRows<T extends{id:number}>(rows:T[],name:string,pack:number){return[...rows].sort((a,b)=>stableHash(`${name}:${pack}:${a.id}`)-stableHash(`${name}:${pack}:${b.id}`)||a.id-b.id).slice((pack-1)*MEDTECH_QUESTION_PACKAGE_SIZE,pack*MEDTECH_QUESTION_PACKAGE_SIZE)}

export function medtechUnitKey(packageName:string,packNumber:number){return `${encodeURIComponent(packageName)}:${Math.max(1,Math.floor(packNumber))}`}
export function parseMedtechUnitKey(key:string){const match=key.match(/^(.+):(\d+)$/u);if(!match)return null;try{return{packageName:decodeURIComponent(match[1]),packNumber:Number(match[2])}}catch{return null}}

export async function listMedtechQuestionUnits(db:Awaited<ReturnType<typeof getDb>>){
 const [sources,questions]=await Promise.all([
  db.select({id:documents.id,storageKey:documents.storageKey,fileName:documents.fileName,subject:documents.subject}).from(documents).where(eq(documents.examCategory,"medtech")),
  db.select({id:examQuestions.id,subject:examQuestions.subject,sourceUrl:examQuestions.sourceUrl}).from(examQuestions).where(and(eq(examQuestions.examCategory,"medtech"),eq(examQuestions.examType,"mcq"),eq(examQuestions.status,"published"))),
 ]);
 const byId=new Map(sources.map(row=>[row.id,row])),byAlias=new Map(sources.flatMap(row=>[[`document:${row.id}`,row],[row.storageKey,row],[row.fileName,row]]as const));
 const grouped=new Map<string,typeof questions>();for(const row of questions){const source=byAlias.get(row.sourceUrl)??byId.get(Number(row.sourceUrl.replace(/^document:/u,"")));const topic=topicOf(source?.fileName??"",source?.subject??row.subject);if(topic)grouped.set(topic,[...(grouped.get(topic)??[]),row])}
 const units:MedtechQuestionUnit[]=[];for(const topic of MEDTECH_UNIT_TOPICS){const rows=grouped.get(topic)??[],count=Math.ceil(rows.length/MEDTECH_QUESTION_PACKAGE_SIZE);for(let pack=1;pack<=count;pack++){const ids=stableRows(rows,topic,pack).map(row=>row.id);if(ids.length)units.push({key:medtechUnitKey(topic,pack),packageName:topic,packNumber:pack,questionIds:ids,questionCount:ids.length,label:`${topic}｜第 ${pack} 組（${ids.length} 題）`})}}
 return units;
}
