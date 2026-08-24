"use client";
import { useEffect,useState } from "react";

type Issue={field:string;kind:string;severity:"P0"|"P1"|"P2";message:string;excerpt:string;autoFixable:boolean};
type Question={id:number;year:string;subject:string;questionNumber:string;stem:string;options:Record<string,string>;explanation?:string;completeExplanation?:string;teacherCompleteExplanation?:string;aiCompleteExplanation?:string};

export default function QualityReviewPage(){
 const [question,setQuestion]=useState<Question|null>(null),[issues,setIssues]=useState<Issue[]>([]),[page,setPage]=useState(1),[matched,setMatched]=useState(false),[loading,setLoading]=useState(true),[notice,setNotice]=useState("");
 const params=typeof window!=="undefined"?new URLSearchParams(window.location.search):new URLSearchParams();
 const documentId=Number(params.get("documentId"));const questionId=Number(params.get("questionId"));
 useEffect(()=>{if(!documentId||!questionId){setLoading(false);return}void (async()=>{try{
   const [qr,pr,ir]=await Promise.all([
    fetch(`/api/medtech/admin/questions?id=${questionId}`,{cache:"no-store"}),
    fetch(`/api/medtech/admin/document-page?documentId=${documentId}&questionId=${questionId}`,{cache:"no-store"}),
    fetch(`/api/medtech/admin/content-quality?documentId=${documentId}`,{cache:"no-store"}),
   ]);
   const qd=await qr.json() as {item?:Question;error?:string};const pd=await pr.json() as {page?:number;matched?:boolean;error?:string};const id=await ir.json() as {items?:Array<{id:number;issues:Issue[]}>};
   if(!qr.ok||!qd.item)throw new Error(qd.error||"找不到題目");setQuestion(qd.item);setPage(pd.page||1);setMatched(pd.matched===true);setIssues(id.items?.find(item=>item.id===questionId)?.issues||[]);
   if(!pd.matched)setNotice("系統未能精準定位頁面，已先開啟第 1 頁；請人工核對原稿。");
  }catch(error){setNotice(error instanceof Error?error.message:"載入失敗")}finally{setLoading(false)}})()},[documentId,questionId]);
 if(loading)return <main style={{padding:30}}>正在定位 PDF 原稿…</main>;
 if(!documentId||!questionId||!question)return <main style={{padding:30}}><h1>無法開啟校對</h1><p>{notice||"缺少文件或題目編號。"}</p></main>;
 return <main style={{height:"100vh",display:"grid",gridTemplateRows:"auto 1fr",fontFamily:"system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif"}}>
  <header style={{display:"flex",justifyContent:"space-between",gap:16,alignItems:"center",padding:"12px 16px",borderBottom:"1px solid #e4e7ec",background:"white"}}><div><b>PDF 原稿精準校對｜第 {question.questionNumber} 題</b><div style={{fontSize:13,color:"#667085"}}>{question.year} · {question.subject} · {matched?`已定位第 ${page} 頁`:`暫開第 ${page} 頁`}</div></div><div style={{display:"flex",gap:8}}><a href={`/medtech/admin/content-quality`} style={{padding:"8px 12px",border:"1px solid #d0d5dd",borderRadius:8,textDecoration:"none",color:"#344054"}}>返回品質中心</a><a href={`/medtech/admin/document-workspace?id=${documentId}`} style={{padding:"8px 12px",border:"1px solid #d0d5dd",borderRadius:8,textDecoration:"none",color:"#344054"}}>完整工作區</a></div></header>
  <section style={{minHeight:0,display:"grid",gridTemplateColumns:"1.15fr .85fr"}}>
   <aside style={{minHeight:0,borderRight:"1px solid #e4e7ec",display:"grid",gridTemplateRows:"auto 1fr"}}><div style={{padding:"10px 12px",display:"flex",justifyContent:"space-between",background:"#f9fafb"}}><b>原始 PDF</b><span>第 {page} 頁</span></div><iframe title="PDF 原稿" src={`/api/medtech/admin/document-source?id=${documentId}#page=${page}&zoom=page-width`} style={{width:"100%",height:"100%",border:0}}/></aside>
   <aside style={{minHeight:0,overflow:"auto",padding:16,background:"#f9fafb"}}>
    {notice&&<p style={{padding:10,background:"#fffaeb",border:"1px solid #fec84b",borderRadius:8}}>{notice}</p>}
    <section style={{background:"white",border:"1px solid #e4e7ec",borderRadius:12,padding:14,marginBottom:12}}><h2 style={{marginTop:0,fontSize:18}}>目前題庫內容</h2><div dangerouslySetInnerHTML={{__html:question.stem}}/><div style={{display:"grid",gap:6,marginTop:10}}>{["A","B","C","D"].map(k=><div key={k}><b>{k}. </b><span dangerouslySetInnerHTML={{__html:question.options?.[k]||""}}/></div>)}</div></section>
    <section style={{background:"white",border:"1px solid #e4e7ec",borderRadius:12,padding:14}}><h2 style={{marginTop:0,fontSize:18}}>偵測到的問題</h2>{issues.length===0?<p>目前沒有品質警示。</p>:<div style={{display:"grid",gap:8}}>{issues.map((issue,index)=><article key={index} style={{padding:10,borderRadius:8,border:`1px solid ${issue.severity==="P0"?"#fda29b":"#fec84b"}`,background:issue.severity==="P0"?"#fff5f3":"#fffaeb"}}><b>{issue.severity}｜{issue.field}</b><div>{issue.message}</div><code style={{display:"block",whiteSpace:"pre-wrap",marginTop:6}}>{issue.excerpt}</code><small>{issue.autoFixable?"高信心規則可處理；仍建議與左側原稿核對。":"不可自動猜測，請依左側原稿人工確認。"}</small></article>)}</div>}</section>
   </aside>
  </section>
 </main>;
}
