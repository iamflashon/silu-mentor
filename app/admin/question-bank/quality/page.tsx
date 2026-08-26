"use client";
import {useEffect,useMemo,useState} from "react";
import {RichQuestionEditor} from "../../../medtech/admin/RichQuestionEditor";
import "../../../medtech/admin/question-workbench.css";
import "./quality.css";

type Doc={id:number;examCategory:string;bookTitle:string;fileName:string;subject:string;questionCount:number};
type Question={id:number;examType?:string;year:string;subject:string;questionNumber:string;stem:string;options?:Record<string,string>;correctAnswer?:string|null;teacherAnswer?:string|null;explanation?:string};
type Flag={severity:"P0"|"P1"|"P2";message:string;auto:boolean};
function plain(value:string){return String(value??"").replace(/<[^>]+>/g," ").replace(/&nbsp;/g," ").replace(/\s+/g," ").trim()}
function flags(q:Question){
 const result:Flag[]=[],options=["A","B","C","D"].map(k=>plain(q.options?.[k]||"")),answer=String(q.teacherAnswer||q.correctAnswer||"").trim().toUpperCase(),essay=q.examType==="essay";
 if(!plain(q.stem))result.push({severity:"P0",message:"題幹為空或拆題失敗",auto:false});
 if(!essay&&!options.every(Boolean))result.push({severity:"P0",message:"A～D 選項不完整",auto:false});
 if(!essay&&!/^[A-D]$/.test(answer))result.push({severity:"P0",message:"缺少有效老師答案",auto:false});
 if(options.some(v=>/(?:解析|解答|計算過程|答案)\s*[：:]/u.test(v)))result.push({severity:"P0",message:"解析或答案疑似混入選項",auto:false});
 if(/[\uE000-\uF8FF�]/u.test([q.stem,...options,q.explanation||""].join(" ")))result.push({severity:"P0",message:"偵測到私人使用區或無法辨識的特殊字元",auto:false});
 if(/(?:[\u4e00-\u9fff]\s+){3,}[\u4e00-\u9fff]/u.test([plain(q.stem),...options].join(" ")))result.push({severity:"P1",message:"偵測到中文字間異常空格",auto:true});
 if(essay&&options.every(Boolean))result.push({severity:"P1",message:"題型標為申論，但仍有完整選項",auto:false});
 return result;
}
function endpoints(category:string){return category==="medtech"?"/api/medtech/admin/questions":category==="data-structure"?"/api/data-structure/admin/questions":"/api/accounting/admin/questions"}

export default function CentralQualityPage(){
 const[docs,setDocs]=useState<Doc[]>([]),[documentId,setDocumentId]=useState(0),[questions,setQuestions]=useState<Question[]>([]),[activeId,setActiveId]=useState(0),[pdfPage,setPdfPage]=useState(1),[pageMatched,setPageMatched]=useState(false),[loading,setLoading]=useState(false),[saving,setSaving]=useState(false),[notice,setNotice]=useState(""),[severity,setSeverity]=useState("all"),[query,setQuery]=useState(""),[docQuery,setDocQuery]=useState(""),[focus,setFocus]=useState(false),[listCollapsed,setListCollapsed]=useState(false);
 useEffect(()=>{try{setFocus(localStorage.getItem("central-quality-focus")==="1");setListCollapsed(localStorage.getItem("central-quality-list-collapsed")==="1")}catch{}},[]);
 function toggleFocus(){setFocus(value=>{const next=!value;try{localStorage.setItem("central-quality-focus",next?"1":"0")}catch{}return next})}
 function toggleList(){setListCollapsed(value=>{const next=!value;try{localStorage.setItem("central-quality-list-collapsed",next?"1":"0")}catch{}return next})}
 useEffect(()=>{void fetch("/api/admin/question-bank-summary",{cache:"no-store"}).then(r=>r.json()).then(d=>{const rows=(d.files??[]).filter((x:Doc)=>["accounting","medtech","data-structure"].includes(x.examCategory));setDocs(rows);const requested=Number(new URLSearchParams(location.search).get("id"));setDocumentId(rows.some((x:Doc)=>x.id===requested)?requested:rows[0]?.id||0)})},[]);
 const doc=docs.find(x=>x.id===documentId);
 const visibleDocs=useMemo(()=>{const needle=docQuery.trim().toLocaleLowerCase();return needle?docs.filter(d=>[d.bookTitle,d.fileName,d.subject].join(" ").toLocaleLowerCase().includes(needle)):docs},[docs,docQuery]);
 useEffect(()=>{if(!doc||!activeId)return;const base=doc.examCategory==="medtech"?"medtech":doc.examCategory==="data-structure"?"data-structure":"accounting";void fetch(`/api/${base}/admin/document-page?documentId=${doc.id}&questionId=${activeId}`,{cache:"no-store"}).then(r=>r.json()).then(d=>{setPdfPage(Number(d.page)||1);setPageMatched(d.matched===true)}).catch(()=>{setPdfPage(1);setPageMatched(false)})},[activeId,doc?.id,doc?.examCategory]);
 async function scan(preferred?:number){if(!doc)return;setLoading(true);setNotice("正在掃描本文件全部題目…");try{const api=endpoints(doc.examCategory);let all:Question[]=[],page=1,total=1;do{const r=await fetch(`${api}?documentId=${documentId}&limit=100&page=${page}&order=source`,{cache:"no-store"}),d=await r.json();if(!r.ok)throw new Error(d.error||"讀取題目失敗");all.push(...(d.items??[]));total=Number(d.total??all.length);page++}while(all.length<total&&page<=50);setQuestions(all);const bad=all.filter(q=>flags(q).length),next=preferred&&bad.some(q=>q.id===preferred)?preferred:bad[0]?.id||0;setActiveId(next);setNotice(`已掃描 ${all.length} 題，找到 ${bad.length} 題需要處理。`)}catch(e){setNotice(e instanceof Error?e.message:"掃描失敗")}finally{setLoading(false)}}
 useEffect(()=>{if(doc)void scan()},[documentId,doc?.examCategory]);
 const issues=useMemo(()=>questions.map(q=>({q,flags:flags(q)})).filter(x=>x.flags.length),[questions]);
 const filtered=issues.filter(item=>(severity==="all"||item.flags.some(f=>f.severity===severity))&&(!query||[item.q.year,item.q.subject,item.q.questionNumber,item.q.stem,...item.flags.map(f=>f.message)].join(" ").toLocaleLowerCase().includes(query.toLocaleLowerCase())));
 const active=questions.find(q=>q.id===activeId)||null,activeIssues=active?flags(active):[];
 const summary={p0:issues.filter(x=>x.flags.some(f=>f.severity==="P0")).length,p1:issues.filter(x=>x.flags.some(f=>f.severity==="P1")).length,auto:issues.filter(x=>x.flags.some(f=>f.auto)).length};
 function update(patch:Partial<Question>){if(active)setQuestions(rows=>rows.map(q=>q.id===active.id?{...q,...patch}:q))}
 async function save(){if(!active||!doc)return;setSaving(true);const currentIndex=filtered.findIndex(x=>x.q.id===active.id),nextId=filtered[currentIndex+1]?.q.id||filtered[0]?.q.id||0;try{const r=await fetch(endpoints(doc.examCategory),{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify(active)}),d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||"儲存失敗");setNotice("本題已儲存，正在開啟下一題。");await scan(nextId===active.id?undefined:nextId)}catch(e){setNotice(e instanceof Error?e.message:"儲存失敗")}finally{setSaving(false)}}
 function removeSpacing(){if(!active)return;const clean=(v:string)=>v.replace(/([\u4e00-\u9fff])\s+(?=[\u4e00-\u9fff])/gu,"$1");update({stem:clean(active.stem),options:Object.fromEntries(Object.entries(active.options||{}).map(([k,v])=>[k,clean(v)]))});setNotice("已移除本題中文字間異常空格；請核對原稿後儲存。")}
 const category=doc?.examCategory==="medtech"?"medtech":doc?.examCategory==="data-structure"?"data-structure":"accounting";
 return <main className={`central-quality${focus?" focus-mode":""}${listCollapsed?" list-collapsed":""}`}>
  <nav className="quality-focus-bar"><button onClick={toggleFocus}>{focus?"退出專注":"專注編修"}</button><button onClick={toggleList}>{listCollapsed?"展開題目列":"收合題目列"}</button>{focus&&<span>{doc?.bookTitle||doc?.fileName||"中央題庫"}{active?` · 第 ${active.questionNumber} 題`:""}</span>}</nav>
  <header><div><a href="/admin/question-bank">← 返回總題庫管理</a><span>CENTRAL QUESTION QA</span><h1>中央題庫品質修復中心</h1><p>自動掃描所有類科文件；修正並儲存後自動前往下一題。</p></div><button onClick={()=>void scan(activeId)} disabled={loading}>{loading?"掃描中…":"重新掃描"}</button></header>
  <section className="quality-summary"><article><span>已掃描</span><b>{questions.length}</b></article><article><span>異常題目</span><b>{issues.length}</b></article><article><span>P0 影響題意</span><b>{summary.p0}</b></article><article><span>P1 結構風險</span><b>{summary.p1}</b></article><article><span>可安全處理</span><b>{summary.auto}</b></article></section>
  <section className="quality-tools"><label>搜尋文件<input value={docQuery} onChange={e=>setDocQuery(e.target.value)} placeholder="書名、檔名或科目…"/></label><label>文件<select value={documentId} onChange={e=>setDocumentId(Number(e.target.value))}>{visibleDocs.map(d=><option key={d.id} value={d.id}>{d.bookTitle||d.fileName}（{d.questionCount} 題）</option>)}</select></label><label>嚴重度<select value={severity} onChange={e=>setSeverity(e.target.value)}><option value="all">全部</option><option value="P0">P0 影響題意</option><option value="P1">P1 結構風險</option><option value="P2">P2 顯示問題</option></select></label><label>搜尋題目<input value={query} onChange={e=>setQuery(e.target.value)} placeholder="題號、題幹、問題…"/></label></section>
  {notice&&<p className="quality-notice">{notice}</p>}
  <section className="quality-workspace">
   <aside><header><b>待處理問題</b><span>{filtered.length} 題</span></header>{filtered.map(({q,flags:found})=><button className={q.id===activeId?"active":""} key={q.id} onClick={()=>setActiveId(q.id)}><b>第 {q.questionNumber} 題</b><span>{q.year} · {q.subject}</span><small>{found[0].message}</small><em>{found.some(f=>f.severity==="P0")?"P0":found.some(f=>f.severity==="P1")?"P1":"P2"}</em></button>)}</aside>
   <section className="quality-source">{active&&doc?<><header><b>PDF／原稿對照</b><span>{doc.bookTitle||doc.fileName} · {pageMatched?`已定位第 ${pdfPage} 頁`:`暫開第 ${pdfPage} 頁`}</span></header><iframe title="原稿" src={`/api/${category}/admin/document-source?id=${doc.id}#page=${pdfPage}&zoom=page-width`}/></>:<p>選擇待修題目。</p>}</section>
   <article className="quality-editor">{active?<><header><div><b>第 {active.questionNumber} 題</b><span>{active.year} · {active.subject}</span></div><button disabled={saving} onClick={()=>void save()}>{saving?"儲存中…":"儲存並下一題"}</button></header><div className="quality-detected">{activeIssues.map((f,i)=><p className={f.severity.toLocaleLowerCase()} key={i}><b>{f.severity}</b>{f.message}{f.auto&&<button onClick={removeSpacing}>套用安全修復</button>}</p>)}</div><div className="quality-meta"><label>年度<input value={active.year} onChange={e=>update({year:e.target.value})}/></label><label>科目<input value={active.subject} onChange={e=>update({subject:e.target.value})}/></label><label>題號<input value={active.questionNumber} onChange={e=>update({questionNumber:e.target.value})}/></label><label>老師答案<select value={active.teacherAnswer||active.correctAnswer||""} onChange={e=>update({teacherAnswer:e.target.value,correctAnswer:e.target.value})}><option value="">未設定</option>{["A","B","C","D"].map(x=><option key={x}>{x}</option>)}</select></label></div><RichQuestionEditor category={category} label="題幹" value={active.stem} onChange={stem=>update({stem})}/>{["A","B","C","D"].map(key=><RichQuestionEditor compact key={key} category={category} label={`選項 ${key}`} value={active.options?.[key]||""} onChange={value=>update({options:{...active.options,[key]:value}})}/>)}<RichQuestionEditor category={category} label="解析" value={active.explanation||""} onChange={explanation=>update({explanation})}/></>:<p>目前沒有待處理題目。</p>}</article>
  </section>
 </main>;
}
