import {and,eq} from "drizzle-orm";
import {examQuestions} from "../../../../db/schema";
import {requireAdmin} from "../../../../lib/member-auth";
import {getOpenAIKey,getOpenAIModel,openAIJson} from "../../../../lib/openai";
function plain(value:string){return String(value??"").replace(/<br\s*\/?\s*>/giu,"\n").replace(/<[^>]+>/gu," ").replace(/\s+/gu," ").trim()}
function outputText(payload:Record<string,unknown>){if(typeof payload.output_text==="string")return payload.output_text.trim();for(const item of Array.isArray(payload.output)?payload.output:[]){const content=item&&typeof item==="object"&&Array.isArray((item as{content?:unknown[]}).content)?(item as{content:unknown[]}).content:[];for(const part of content)if(part&&typeof part==="object"&&typeof(part as{text?:unknown}).text==="string")return(part as{text:string}).text.trim()}return""}
export async function POST(request:Request){
 const auth=await requireAdmin(request);if("error"in auth)return auth.error;const{id,category}=await request.json() as{id?:number;category?:string};
 if(!Number.isInteger(Number(id))||!["accounting","medtech","data-structure"].includes(String(category)))return Response.json({error:"題目資料不完整"},{status:400});
 if(!await getOpenAIKey())return Response.json({error:"AI 模型尚未設定"},{status:503});
 const[question]=await auth.db.select().from(examQuestions).where(and(eq(examQuestions.id,Number(id)),eq(examQuestions.examCategory,String(category)))).limit(1);if(!question)return Response.json({error:"找不到題目"},{status:404});
 const options=JSON.parse(question.optionsJson||"{}") as Record<string,string>;if(!["A","B","C","D"].every(key=>plain(options[key])))return Response.json({error:"選項尚未拆解完整，請先核對原稿，不宜判斷答案"},{status:422});
 const model=await getOpenAIModel("gpt-5.6-luna"),payload=await openAIJson("/responses",{method:"POST",body:JSON.stringify({model,instructions:"你是題庫答案覆核助理。依題幹、A到D選項與既有解析獨立推論最可能答案。這只是供老師核對的建議，絕不能宣稱是官方答案。如果 A 到 D 都不正確，answer 必須回傳 NONE，不可硬猜最接近的選項。若題幹選項錯位、資料不足或無法唯一作答，mustReview 必須為 true 並說明。使用繁體中文。",input:`類科：${category}\n科目：${question.subject}\n年份：${question.year}\n題號：${question.questionNumber}\n題幹：${plain(question.stem)}\n選項：${JSON.stringify(Object.fromEntries(Object.entries(options).map(([k,v])=>[k,plain(v)])))}\n既有解析：${plain(question.explanation)||"無"}`,text:{format:{type:"json_schema",name:"answer_suggestion",strict:true,schema:{type:"object",additionalProperties:false,properties:{answer:{type:"string",enum:["A","B","C","D","NONE"]},reason:{type:"string"},confidence:{type:"string",enum:["high","medium","low"]},mustReview:{type:"boolean"}},required:["answer","reason","confidence","mustReview"]}}},max_output_tokens:900})});
 let result:{answer?:string;reason?:string;confidence?:string;mustReview?:boolean}={};try{result=JSON.parse(outputText(payload))}catch{}if(!/^(?:[A-D]|NONE)$/.test(String(result.answer||"")))return Response.json({error:"目前無法形成可靠建議，請人工核對原稿"},{status:422});
 return Response.json({suggestion:{answer:result.answer,reason:String(result.reason||"請核對原稿"),confidence:result.confidence||"low",mustReview:result.mustReview!==false},model});
}
