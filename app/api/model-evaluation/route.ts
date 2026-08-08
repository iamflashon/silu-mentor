import { and, asc, eq, inArray } from "drizzle-orm";
import { getDb } from "../../../db";
import { chatComparisonRatings, chatComparisonResponses, chatComparisons, usageLogs } from "../../../db/schema";
import { benchmarkCases } from "../../../lib/model-benchmark";
import { estimateCostUsd } from "../../../lib/usage";
const estimateUsageCostUsd = estimateCostUsd;
import { getAnthropicChatModel, getAnthropicKey, getDeepSeekKey, getDeepSeekModel, getOpenAIKey, getTeachingJudgeOpenAIModel, getZaiKey, openAIJson } from "../../../lib/openai";

type Provider = "luna" | "sonnet" | "deepseek" | "glm52";
const providerLabels: Record<Provider,string> = { luna:"Luna", sonnet:"Claude Sonnet 5", deepseek:"DeepSeek V4-Pro", glm52:"GLM-5.2" };

function outputText(payload: Record<string,unknown>) {
  const direct = typeof payload.output_text === "string" ? payload.output_text : "";
  if (direct) return direct.trim();
  const output = Array.isArray(payload.output) ? payload.output : [];
  return output.flatMap((item) => typeof item === "object" && item ? (Array.isArray((item as {content?:unknown[]}).content) ? (item as {content:unknown[]}).content : []) : [])
    .map((item) => typeof item === "object" && item && typeof (item as {text?:unknown}).text === "string" ? (item as {text:string}).text : "").join("\n").trim();
}
function parseJson(text: string) { const match=text.match(/\{[\s\S]*\}/); if(!match) throw new Error("Sol 未回傳可解析評分"); return JSON.parse(match[0]) as Record<string,unknown>; }

async function runCandidate(provider: Provider, prompt: string) {
  const system = "你是臺灣司律考試法律助教。只依題目明示事實分析；先檢查提問是否藏有錯誤法律前提，不可迎合，不得虛構法條、判決或教材。請直接回答並說明法律判準與涵攝，控制在700字內。";
  const started=Date.now();
  if(provider==="luna"){
    if(!await getOpenAIKey()) throw new Error("OpenAI 金鑰未設定");
    const model="gpt-5.6-luna";
    const p=await openAIJson("/responses",{method:"POST",body:JSON.stringify({model,instructions:system,input:prompt,max_output_tokens:1800})});
    const u=(p.usage??{}) as {input_tokens?:number;output_tokens?:number}; return {model,text:outputText(p),input:Number(u.input_tokens??0),output:Number(u.output_tokens??0),duration:Date.now()-started};
  }
  if(provider==="sonnet"){
    const key=await getAnthropicKey(); if(!key) throw new Error("Anthropic 金鑰未設定"); const model=await getAnthropicChatModel("claude-sonnet-5");
    const r=await fetch("https://api.anthropic.com/v1/messages",{method:"POST",headers:{"x-api-key":key,"anthropic-version":"2023-06-01","content-type":"application/json"},body:JSON.stringify({model,system,messages:[{role:"user",content:prompt}],max_tokens:1800})}); const p=await r.json() as {content?:Array<{text?:string}>;usage?:{input_tokens?:number;output_tokens?:number};error?:{message?:string}}; if(!r.ok) throw new Error(p.error?.message||"Claude 呼叫失敗"); return {model,text:p.content?.map(x=>x.text||"").join("\n").trim()||"",input:Number(p.usage?.input_tokens??0),output:Number(p.usage?.output_tokens??0),duration:Date.now()-started};
  }
  if(provider==="deepseek"){
    const key=await getDeepSeekKey(); if(!key) throw new Error("DeepSeek 金鑰未設定"); const model=await getDeepSeekModel("deepseek-v4-pro");
    const r=await fetch("https://api.deepseek.com/chat/completions",{method:"POST",headers:{authorization:`Bearer ${key}`,"content-type":"application/json"},body:JSON.stringify({model,messages:[{role:"system",content:system},{role:"user",content:prompt}],max_tokens:1800})}); const p=await r.json() as {choices?:Array<{message?:{content?:string}}> ;usage?:{prompt_tokens?:number;completion_tokens?:number};error?:{message?:string}}; if(!r.ok) throw new Error(p.error?.message||"DeepSeek 呼叫失敗"); return {model,text:p.choices?.[0]?.message?.content?.trim()||"",input:Number(p.usage?.prompt_tokens??0),output:Number(p.usage?.completion_tokens??0),duration:Date.now()-started};
  }
  const key=await getZaiKey(); if(!key) throw new Error("Z.AI 金鑰未設定"); const model="glm-5.2";
  const r=await fetch("https://api.z.ai/api/paas/v4/chat/completions",{method:"POST",headers:{authorization:`Bearer ${key}`,"content-type":"application/json"},body:JSON.stringify({model,messages:[{role:"system",content:system},{role:"user",content:prompt}],thinking:{type:"enabled"},max_tokens:1800})}); const p=await r.json() as {choices?:Array<{message?:{content?:string}}> ;usage?:{prompt_tokens?:number;completion_tokens?:number};error?:{message?:string}}; if(!r.ok) throw new Error(p.error?.message||"GLM 呼叫失敗"); return {model,text:p.choices?.[0]?.message?.content?.trim()||"",input:Number(p.usage?.prompt_tokens??0),output:Number(p.usage?.completion_tokens??0),duration:Date.now()-started};
}

async function judge(question: typeof benchmarkCases[number], answer: string) {
  const model=await getTeachingJudgeOpenAIModel("gpt-5.6-sol");
  const prompt=`你是本測試唯一裁判 Sol。請依標準卡評估候選模型回答，不得因文筆漂亮加分。\n【題目】${question.prompt}\n【正確判準】${question.rule}\n【預期方向】${question.expected}\n【不得補充】${question.forbidden.join("、")||"無"}\n【致命錯誤】${question.fatal.join("、")||"依一般規則"}\n【候選回答】${answer}\n只回傳JSON：{"rule":0到25,"application":0到20,"premise":0到15,"facts":0到15,"sources":0到10,"continuity":0到10,"teaching":0到5,"fatal":[],"verdict":"pass或fail","summary":"150字內評語","correction":"更正後核心答案"}。若有核心判準錯誤、虛構來源、偷加關鍵事實或迎合錯誤前提，verdict必須為fail且總分為0。`;
  const started=Date.now(); const p=await openAIJson("/responses",{method:"POST",body:JSON.stringify({model,input:prompt,max_output_tokens:1600})}); const raw=outputText(p); const parsed=parseJson(raw); const u=(p.usage??{}) as {input_tokens?:number;output_tokens?:number};
  const weighted=["rule","application","premise","facts","sources","continuity","teaching"].reduce((s,k)=>s+Number(parsed[k]??0),0); const fatal=Array.isArray(parsed.fatal)?parsed.fatal.map(String):[]; const failed=parsed.verdict==="fail"||fatal.length>0; return {model,score:failed?0:Math.max(0,Math.min(100,weighted)),weighted,fatal,summary:String(parsed.summary??""),correction:String(parsed.correction??""),input:Number(u.input_tokens??0),output:Number(u.output_tokens??0),duration:Date.now()-started};
}

export async function GET(){
  const db=await getDb(); const comparisons=await db.select().from(chatComparisons).where(eq(chatComparisons.contextType,"model-benchmark-v2")).orderBy(asc(chatComparisons.id)); const ids=comparisons.map(x=>x.id); const responses=ids.length?await db.select().from(chatComparisonResponses).where(inArray(chatComparisonResponses.comparisonId,ids)):[]; const responseIds=responses.map(x=>x.id); const ratings=responseIds.length?await db.select().from(chatComparisonRatings).where(inArray(chatComparisonRatings.responseId,responseIds)):[];
  return Response.json({target:50,judge:"GPT-5.6 Sol",questions:benchmarkCases.map(q=>{const c=comparisons.find(x=>{try{return JSON.parse(x.sourceJson).benchmarkId===q.id}catch{return false}});return {...q,responses:c?responses.filter(r=>r.comparisonId===c.id).map(r=>{const e=ratings.filter(x=>x.responseId===r.id&&x.feedbackType==="sol_benchmark").at(-1);let verdict=null;try{verdict=e?JSON.parse(e.note):null}catch{}return {...r,verdict}}):[]}})});
}

export async function POST(request:Request){
  try{const body=await request.json() as {questionId?:number;provider?:Provider}; const q=benchmarkCases.find(x=>x.id===Number(body.questionId)); const provider=body.provider; if(!q||!provider||!providerLabels[provider]) return Response.json({error:"測試參數不完整"},{status:400}); const db=await getDb(); const existing=await db.select().from(chatComparisons).where(eq(chatComparisons.contextType,"model-benchmark-v2")); let comparison=existing.find(x=>{try{return JSON.parse(x.sourceJson).benchmarkId===q.id}catch{return false}}); if(!comparison){[comparison]=await db.insert(chatComparisons).values({userKey:"benchmark",contextType:"model-benchmark-v2",promptText:q.prompt,sourceStatus:"benchmark_card",sourceJson:JSON.stringify({benchmarkId:q.id,rule:q.rule,expected:q.expected})}).returning();}
    const prior=await db.select().from(chatComparisonResponses).where(and(eq(chatComparisonResponses.comparisonId,comparison.id),eq(chatComparisonResponses.label,providerLabels[provider]))).limit(1); if(prior[0]) return Response.json({ok:true,skipped:true});
    let benchmarkPrompt=q.prompt;
    if(q.group==="連續追問"&&q.round>1){
      const previousCases=benchmarkCases.filter(x=>x.group==="連續追問"&&x.title===q.title&&x.round<q.round);
      const transcript:string[]=[];
      for(const previousCase of previousCases){
        const previousComparison=existing.find(x=>{try{return JSON.parse(x.sourceJson).benchmarkId===previousCase.id}catch{return false}});
        if(!previousComparison)continue;
        const [previousAnswer]=await db.select().from(chatComparisonResponses).where(and(eq(chatComparisonResponses.comparisonId,previousComparison.id),eq(chatComparisonResponses.label,providerLabels[provider]))).limit(1);
        if(previousAnswer)transcript.push(`學生：${previousCase.prompt}\n助教：${previousAnswer.text}`);
      }
      benchmarkPrompt=`以下是同一段對話的既有內容，必須承接且不得遺忘：\n${transcript.join("\n\n")}\n\n學生現在追問：${q.prompt}`;
    }
    const run=await runCandidate(provider,benchmarkPrompt); const cost=estimateUsageCostUsd(run.model,{inputTokens:run.input,cachedTokens:0,outputTokens:run.output}); const [row]=await db.insert(chatComparisonResponses).values({comparisonId:comparison.id,provider,model:run.model,label:providerLabels[provider],text:run.text,inputTokens:run.input,outputTokens:run.output,durationMs:run.duration,estimatedCostUsdMicros:Math.round(cost*1e6)}).returning(); await db.insert(usageLogs).values({model:run.model,source:"50題法律模型測試",inputTokens:run.input,outputTokens:run.output,estimatedCostUsdMicros:Math.round(cost*1e6)});
    const j=await judge(q,run.text); const judgeCost=estimateUsageCostUsd(j.model,{inputTokens:j.input,cachedTokens:0,outputTokens:j.output}); await db.insert(chatComparisonRatings).values({comparisonId:comparison.id,responseId:row.id,userKey:"sol-judge",score:j.score,feedbackType:"sol_benchmark",note:JSON.stringify({...j,judgeCostUsd:judgeCost})}); await db.insert(usageLogs).values({model:j.model,source:"50題法律測試 Sol 自動判卷",inputTokens:j.input,outputTokens:j.output,estimatedCostUsdMicros:Math.round(judgeCost*1e6)}); return Response.json({ok:true,score:j.score});
  }catch(error){return Response.json({error:error instanceof Error?error.message:"測試失敗"},{status:500});}
}
