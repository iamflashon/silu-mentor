"use client";

import { useCallback, useEffect, useState } from "react";

type Policy = { enabled:boolean; name:string; price:number; quota:number; durationDays:number; coachRounds:number; autoRenew:false; categories:string[]; notes:string };
type Code = { id:string; last4:string; label:string; status:string; categories:string[]; redeemBy:string|null; createdAt:string; redeemedAt:string|null; redeemedBy:string|null };
type Payload = { policy:Policy; codes:Code[]; updatedAt:string; generatedCodes?:string[]; error?:string };

const categoryOptions = [{id:"law",label:"司律／法律"},{id:"accounting",label:"會計"},{id:"medtech",label:"醫檢師"},{id:"data-structure",label:"資料結構"}];
const statusLabels:Record<string,string>={unused:"未使用",redeemed:"已兌換",disabled:"已停用",expired:"已過期"};

export default function AiAccessAdminPage(){
  const [policy,setPolicy]=useState<Policy|null>(null),[codes,setCodes]=useState<Code[]>([]),[notice,setNotice]=useState(""),[busy,setBusy]=useState(false),[count,setCount]=useState(10),[label,setLabel]=useState("培訓學生贈送"),[redeemBy,setRedeemBy]=useState(""),[generated,setGenerated]=useState<string[]>([]);
  const load=useCallback(async()=>{const response=await fetch("/api/admin/ai-access",{cache:"no-store"});const data=await response.json() as Payload;if(response.ok){setPolicy(data.policy);setCodes(data.codes)}else setNotice(data.error??"讀取失敗")},[]);
  useEffect(()=>{void load()},[load]);
  async function post(body:Record<string,unknown>){setBusy(true);setNotice("");try{const response=await fetch("/api/admin/ai-access",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)});const data=await response.json() as Payload;if(!response.ok)throw new Error(data.error??"操作失敗");setPolicy(data.policy);setCodes(data.codes);return data}catch(error){setNotice(error instanceof Error?error.message:"操作失敗");return null}finally{setBusy(false)}}
  async function save(){if(!policy)return;const data=await post({action:"save-policy",policy});if(data)setNotice("AI 方案規則已儲存；目前仍維持草稿／管理設定，不會自動開始向學生扣次。")}
  async function generate(){const data=await post({action:"generate-codes",count,label,redeemBy:redeemBy||null,categories:policy?.categories??[]});if(data){setGenerated(data.generatedCodes??[]);setNotice(`已產生 ${data.generatedCodes?.length??0} 組一次性啟用碼。完整碼只在本次畫面顯示，請立即複製保存。`)}}
  async function disable(id:string){const data=await post({action:"disable-code",id});if(data)setNotice("啟用碼已停用。")}
  function toggleCategory(id:string){if(!policy)return;setPolicy({...policy,categories:policy.categories.includes(id)?policy.categories.filter(value=>value!==id):[...policy.categories,id]})}
  return <main className="ai-access-admin">
    <header className="ai-access-hero"><div><p>GLOBAL AI ACCESS CONTROL</p><h1>AI 方案與啟用碼</h1><span>總管理共用規則，可套用司律、會計、醫檢師與資料結構；各類科不另建重複方案。</span></div><a href="/admin">返回總管理後台 →</a></header>
    {!policy?<section className="ai-access-card">讀取方案設定中…</section>:<>
      <section className="ai-access-card"><div className="ai-access-section-title"><div><h2>30 天 AI 試問方案</h2><p>目前先建立規則與管理介面；啟用前不會影響既有學生權益。</p></div><label className="ai-access-switch"><input type="checkbox" checked={policy.enabled} onChange={event=>setPolicy({...policy,enabled:event.target.checked})}/><span>{policy.enabled?"標記為啟用":"草稿模式"}</span></label></div>
      <div className="ai-access-grid"><label>方案名稱<input value={policy.name} onChange={event=>setPolicy({...policy,name:event.target.value})}/></label><label>單次售價 NT$<input type="number" min="1" value={policy.price} onChange={event=>setPolicy({...policy,price:Number(event.target.value)})}/></label><label>AI 學習額度<input type="number" min="1" value={policy.quota} onChange={event=>setPolicy({...policy,quota:Number(event.target.value)})}/></label><label>有效天數<input type="number" min="1" value={policy.durationDays} onChange={event=>setPolicy({...policy,durationDays:Number(event.target.value)})}/></label><label>每次教練任務包含輪數<input type="number" min="1" value={policy.coachRounds} onChange={event=>setPolicy({...policy,coachRounds:Number(event.target.value)})}/></label><label>續約方式<input value="單次購買，不自動續約" disabled/></label></div>
      <fieldset className="ai-access-scope"><legend>適用類科</legend>{categoryOptions.map(item=><label key={item.id}><input type="checkbox" checked={policy.categories.includes(item.id)} onChange={()=>toggleCategory(item.id)}/>{item.label}</label>)}</fieldset>
      <label className="ai-access-notes">總管理註記<textarea rows={5} value={policy.notes} onChange={event=>setPolicy({...policy,notes:event.target.value})}/></label>
      <div className="ai-access-actions"><button type="button" onClick={()=>void save()} disabled={busy}>{busy?"儲存中…":"儲存方案規則"}</button></div></section>

      <section className="ai-access-card ai-access-rules"><h2>全平台統一計次規則</h2><div><article><b>一般 AI 試問</b><strong>成功回答扣 1 次</strong><p>首頁導師、教材追問、爭點追問與答題後 AI 說明統一計算。</p></article><article><b>AI 教練</b><strong>{policy.coachRounds} 輪引導扣 1 次</strong><p>同一題、同一任務；繼續下一組引導時再扣一次。</p></article><article><b>不扣次</b><strong>閱讀與系統失敗</strong><p>既有解析、教材搜尋、歷史紀錄、逾時、錯誤及管理員測試均不扣。</p></article><article><b>到期與續購</b><strong>{policy.durationDays} 天後失效</strong><p>不累積、不轉讓、不折現；額度用完或到期後由學生自行重新購買。</p></article></div><aside>重要：只有 AI 成功產生有效回答後才扣除額度；不得在按下送出時先扣。LINE Pay 為單次付款，不設定自動續約。</aside></section>

      <section className="ai-access-card"><div className="ai-access-section-title"><div><h2>免費一次性啟用碼</h2><p>提供培訓學生、老師、讀友或行銷試用；一碼限一個會員兌換一次。</p></div><span className="ai-access-count">{codes.length} 組紀錄</span></div><div className="ai-code-generator"><label>活動名稱<input value={label} onChange={event=>setLabel(event.target.value)}/></label><label>產生數量<input type="number" min="1" max="100" value={count} onChange={event=>setCount(Number(event.target.value))}/></label><label>最晚兌換日（可留空）<input type="date" value={redeemBy} onChange={event=>setRedeemBy(event.target.value)}/></label><button type="button" onClick={()=>void generate()} disabled={busy}>產生啟用碼</button></div>
      {!!generated.length&&<div className="ai-generated-codes"><header><b>本次產生的完整啟用碼</b><button type="button" onClick={()=>void navigator.clipboard.writeText(generated.join("\n"))}>全部複製</button></header><pre>{generated.join("\n")}</pre><small>系統只保存雜湊與末四碼；離開本頁後無法再次查看完整碼。</small></div>}
      <div className="ai-code-list">{codes.length?codes.slice(0,100).map(code=><article key={code.id}><div><b>{code.label}</b><span>••••-{code.last4} · {code.categories.map(id=>categoryOptions.find(item=>item.id===id)?.label??id).join("、")}</span><small>建立 {new Date(code.createdAt).toLocaleString("zh-TW")}{code.redeemBy?` · ${code.redeemBy} 前兌換`:" · 無兌換截止日"}</small></div><em className={`ai-code-${code.status}`}>{statusLabels[code.status]??code.status}</em>{code.status==="unused"&&<button type="button" onClick={()=>void disable(code.id)} disabled={busy}>停用</button>}</article>):<p>尚未產生啟用碼。</p>}</div></section>
    </>}
    {notice&&<p className="ai-access-notice" role="status">{notice}</p>}
  </main>
}
