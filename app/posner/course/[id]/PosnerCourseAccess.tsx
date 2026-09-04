"use client";
import { FormEvent, useState } from "react";
import CourseVideoPlayer from "../../../course-video-player";

type Props={courseId:number;title:string;sourceUrl:string;owned:boolean;expiresAt:string|null;price:number;accessDays:number;previewStartSeconds:number;previewDurationSeconds:number;salesEnabled:boolean;signedIn:boolean};
export default function PosnerCourseAccess(p:Props){
 const[ended,setEnded]=useState(false),[busy,setBusy]=useState(false),[code,setCode]=useState(""),[notice,setNotice]=useState("");
 const login=()=>{location.href=`/member-login?return_to=${encodeURIComponent(`/posner/course/${p.courseId}`)}`};
 async function buy(){if(!p.signedIn)return login();setBusy(true);setNotice("");const r=await fetch("/api/posner/line-pay/request",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({courseId:p.courseId})}),d=await r.json()as{paymentUrl?:string;redirectUrl?:string;error?:string};if(d.paymentUrl)location.href=d.paymentUrl;else if(d.redirectUrl)location.href=d.redirectUrl;else{setNotice(d.error||"目前無法建立付款");setBusy(false)}}
 async function redeem(e:FormEvent){e.preventDefault();if(!p.signedIn)return login();setBusy(true);setNotice("");const r=await fetch("/api/posner/redeem",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({courseId:p.courseId,code})}),d=await r.json()as{ok?:boolean;error?:string};if(d.ok)location.reload();else{setNotice(d.error||"兌換失敗");setBusy(false)}}
 const actions=<><button onClick={()=>void buy()} disabled={busy||!p.salesEnabled}>{p.salesEnabled?`LINE Pay NT$${p.price} 購買`:"目前未開放購買"}</button><form onSubmit={redeem}><input value={code} onChange={e=>setCode(e.target.value.toUpperCase())} placeholder="輸入兌換碼"/><button disabled={busy||!code.trim()}>立即兌換</button></form></>;
 return <section className="posner-watch">
  <div className="posner-player-wrap"><CourseVideoPlayer resourceId={p.courseId} sourceUrl={p.sourceUrl} title={p.title} startSeconds={0} onTimeChange={s=>{if(!p.owned&&p.previewDurationSeconds>0&&s>=p.previewDurationSeconds-1)setEnded(true)}}/>{!p.owned&&ended&&<div className="posner-preview-lock"><div><span>精彩試看已結束</span><h2>繼續看完整課程</h2><p>LINE Pay 付款或輸入兌換碼後，立即從這裡繼續觀看。</p>{actions}{notice&&<small role="alert">{notice}</small>}</div></div>}</div>
  <div className="posner-access-bar"><div><b>{p.owned?"完整課程已開通":`免費試看 ${Math.floor(p.previewDurationSeconds/60)} 分 ${p.previewDurationSeconds%60} 秒`}</b><span>{p.owned&&p.expiresAt?`可觀看至 ${new Date(p.expiresAt).toLocaleDateString("zh-TW")}`:`精彩片段從 ${Math.floor(p.previewStartSeconds/60)}:${String(p.previewStartSeconds%60).padStart(2,"0")} 開始`}</span></div>{!p.owned&&<div className="posner-buy-actions"><button onClick={()=>void buy()} disabled={busy||!p.salesEnabled}>{p.salesEnabled?`LINE Pay NT$${p.price}｜觀看 ${p.accessDays} 天`:"暫停銷售"}</button><form onSubmit={redeem}><input value={code} onChange={e=>setCode(e.target.value.toUpperCase())} placeholder="兌換碼"/><button disabled={busy||!code.trim()}>兌換</button></form></div>}</div>
  {notice&&<p className="posner-payment-notice" role="alert">{notice}</p>}
 </section>
}
