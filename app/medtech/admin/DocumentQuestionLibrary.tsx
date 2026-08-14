"use client";
import { useEffect,useState } from "react";
import "./document-question-library.css";
type Doc={id:number;name:string;subject:string;type:string;sizeBytes:number;status:string;processingStage:string;processingMessage:string;questionCount:number;pageCount?:number|null;error?:string|null};
const stage=(doc:Doc)=>doc.processingStage==="completed"?"可進入工作區":doc.status==="failed"?"處理失敗":"文件處理中";
export default function DocumentQuestionLibrary(){
 const [docs,setDocs]=useState<Doc[]>([]),[loading,setLoading]=useState(true),[notice]=useState("");
 async function load(){const response=await fetch("/api/medtech/documents",{cache:"no-store"});const data=await response.json() as {documents?:Doc[]};setDocs(data.documents??[]);setLoading(false)}
 useEffect(()=>{void load();const timer=window.setInterval(()=>void load(),4000);return()=>window.clearInterval(timer)},[]);
 function open(doc:Doc){if(doc.processingStage!=="completed")return;location.href=`/medtech/admin/document-workspace?id=${doc.id}&autoImport=${doc.questionCount?"0":"1"}`}
 return <><section className="medtech-admin-panel file-question-heading"><div><span>以文件為單位</span><h2>醫檢文件題庫</h2><p>每份原稿對應自己的題目清單；進入後可對照完整PDF並使用富文字編輯。</p></div><a href="/medtech/admin/unlinked-questions">舊題庫／未配對題目</a></section>{notice&&<section className="medtech-admin-panel library-notice">{notice}</section>}<section className="medtech-admin-panel"><div className="file-question-list">{loading?<p>正在讀取文件題庫…</p>:docs.map(doc=><article key={doc.id}><div className="file-icon">{doc.name.toLowerCase().endsWith(".pdf")?"PDF":"DOC"}</div><div className="file-info"><span>{doc.subject} · {doc.type}</span><h3>{doc.name}</h3><small>{(doc.sizeBytes/1048576).toFixed(2)} MB{doc.pageCount?` · ${doc.pageCount} 頁`:""}</small></div><div className={`file-stage ${doc.processingStage}`}><b>{stage(doc)}</b><span>{doc.error||doc.processingMessage}</span><i/></div><div className="file-question-count"><b>{doc.questionCount}</b><span>拆出題目</span></div><button disabled={doc.processingStage!=="completed"} onClick={()=>open(doc)}>{doc.questionCount?"開啟對照工作區":"進入並開始拆題"}</button></article>)}{!loading&&!docs.length&&<div className="file-empty"><b>尚無文件題庫</b><p>請先到「文件上傳」新增PDF或Word原稿。</p></div>}</div></section></>
}
