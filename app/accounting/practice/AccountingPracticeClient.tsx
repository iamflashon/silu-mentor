"use client";
import { useEffect, useState } from "react";
type Q={id:number;year:string;examName:string;questionNumber:string;stem:string;optionsJson:string|null;correctAnswer:string|null;explanation:string;teacherNotes:string};
type Facets={papers:string[]};
const WORD_SOURCE="115年會計研究所班 中級會計學";
function paperLabel(value:string){return value.replace(/^115年\s*/u,"").replace(/^會計研究所班\s*/u,"").replace(/^高點會研所班\s*/u,"高點會研所班｜").replace(/^高雄暑期班/u,"高雄暑期班｜").replace(/\s+(第\d+次(?:小考|複習考|模擬考)\d*)$/u,"｜$1")}
function questionInPaper(notes:string){return notes.match(/原始列序：(\d+)/u)?.[1]??""}
export default function AccountingPracticeClient(){
 const [items,setItems]=useState<Q[]>([]),[index,setIndex]=useState(0),[selected,setSelected]=useState(""),[page,setPage]=useState(1),[total,setTotal]=useState(0),[notice,setNotice]=useState("正在載入已發布的中會選擇題…");
 const [paper,setPaper]=useState("all"),[facets,setFacets]=useState<Facets>({papers:[]});
 async function load(target=1){const r=await fetch(`/api/exam-questions?examCategory=accounting&status=published&examType=mcq&page=${target}&sourceBook=${encodeURIComponent(WORD_SOURCE)}&paper=${encodeURIComponent(paper)}`,{cache:"no-store"});const d=await r.json() as {items?:Q[];total?:number;filters?:Partial<Facets>};const rows=d.items??[];setItems(rows);setTotal(d.total??0);setFacets(old=>({papers:d.filters?.papers??old.papers}));setIndex(0);setSelected("");setPage(target);setNotice(rows.length?`目前試卷共 ${d.total??0} 題；作答後顯示老師解析。`:"這份試卷目前沒有可練習的完整選擇題。")}
 useEffect(()=>{void load()},[]);
 const q=items[index];let options:Record<string,string>={};try{options=JSON.parse(q?.optionsJson||"{}") as Record<string,string>}catch{}
 const answered=Boolean(selected);
 return <section className="accounting-practice-shell"><header><span>115年會研所班 Word 題庫</span><h1>選一份試卷，逐題練習</h1><p>{notice}</p></header>
 <div className="accounting-bank-filters word-only"><label>試卷<select value={paper} onChange={e=>setPaper(e.target.value)}><option value="all">全部 Word 試卷</option>{facets.papers.map(v=><option value={v} key={v}>{paperLabel(v)}</option>)}</select></label><button onClick={()=>void load(1)}>套用試卷</button></div>
 {q?<article className="accounting-practice-card"><small>{paperLabel(q.teacherNotes.match(/^內部來源：(.+?)\.docx｜/u)?.[1]??WORD_SOURCE)}｜第 {questionInPaper(q.teacherNotes)||q.questionNumber} 題　·　本頁第 {index+1}/{items.length} 題</small><h2>{q.stem}</h2><div className="accounting-options">{["A","B","C","D"].map(key=><button className={answered?(key===q.correctAnswer?"correct":key===selected?"wrong":""):selected===key?"selected":""} disabled={answered} onClick={()=>setSelected(key)} key={key}><b>{key}</b><span>{options[key]}</span></button>)}</div>{answered&&<section className="accounting-practice-explanation"><b>{selected===q.correctAnswer?"答對了":"這題答案是 "+(q.correctAnswer||"尚待核對")}</b><p>{q.explanation||"老師原檔目前沒有獨立解析，可回首頁把這題交給 Luna 助教講解。"}</p><small>題庫來源：{WORD_SOURCE}</small></section>}<footer><button disabled={index===0} onClick={()=>{setIndex(v=>v-1);setSelected("")}}>上一題</button><button disabled={!selected} onClick={()=>{if(index<items.length-1){setIndex(v=>v+1);setSelected("")}else if(page*10<total)void load(page+1)}}>{index<items.length-1||page*10<total?"下一題":"本頁完成"}</button></footer></article>:<div className="accounting-practice-empty"><b>這份試卷目前沒有完整題目</b><p>請改選其他 Word 試卷。</p></div>}</section>;
}
