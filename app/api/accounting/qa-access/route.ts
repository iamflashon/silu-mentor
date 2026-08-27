import { trialStatus } from "../../../../lib/accounting-qa-trial";

function reply(payload:unknown,setCookie="",status=200){const headers=new Headers({"cache-control":"no-store","content-type":"application/json"});if(setCookie)headers.set("set-cookie",setCookie);return new Response(JSON.stringify(payload),{status,headers})}
export async function GET(request:Request){const state=await trialStatus(request);return reply(state,state.setCookie)}
export async function POST(request:Request){
  const state=await trialStatus(request),body=await request.json() as {displayName?:string;email?:string;reason?:string};
  const displayName=String(body.displayName||"").trim().slice(0,60),email=String(body.email||"").trim().toLowerCase().slice(0,160),reason=String(body.reason||"").trim().slice(0,800);
  if(!state.blocked)return reply({error:"額度尚未用完，目前不需要申請。"},state.setCookie,400);
  if(!displayName||!/^\S+@\S+\.\S+$/.test(email)||reason.length<5)return reply({error:"請填寫稱呼、有效 Email 與至少 5 個字的申請理由。"},state.setCookie,400);
  const{env}=await import("cloudflare:workers");
  const existing=await env.DB.prepare("SELECT id FROM accounting_qa_trial_requests WHERE device_key=? AND status='pending' LIMIT 1").bind(state.deviceKey).first();
  if(existing)return reply({ok:true,pending:true,message:"申請已送出，請等候管理者審核。"},state.setCookie);
  const latest=await env.DB.prepare("SELECT requested_at AS requestedAt FROM accounting_qa_trial_requests WHERE device_key=? ORDER BY requested_at DESC LIMIT 1").bind(state.deviceKey).first<{requestedAt:number}>();
  if(latest&&Date.now()-Number(latest.requestedAt)<60*60*1000)return reply({error:"申請送出後一小時內不可重複申請，請稍後再試。"},state.setCookie,429);
  await env.DB.prepare("INSERT INTO accounting_qa_trial_requests (device_key,display_name,email,reason,status,grant_count,requested_at,resolved_by) VALUES (?,?,?,?, 'pending',0,?, '')").bind(state.deviceKey,displayName,email,reason,Date.now()).run();
  return reply({ok:true,pending:true,message:"申請已送出，請等候管理者審核。"},state.setCookie);
}
