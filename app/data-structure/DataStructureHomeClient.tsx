"use client";
import { useEffect, useLayoutEffect, useState } from "react";
import AccountingCoach from "../accounting/AccountingCoach";

export default function DataStructureHomeClient({canAdmin}:{canAdmin:boolean}){
 const [studentPreview,setStudentPreview]=useState(false);
 useEffect(()=>{if(canAdmin)setStudentPreview(window.localStorage.getItem("data-structure-student-preview")==="1")},[canAdmin]);
 useLayoutEffect(()=>{if(!window.matchMedia("(max-width: 800px)").matches)return;const previous=window.history.scrollRestoration;window.history.scrollRestoration="manual";if(window.location.hash)window.history.replaceState(null,"",window.location.pathname);const reset=()=>window.scrollTo(0,0);reset();const a=requestAnimationFrame(reset),b=setTimeout(reset,150),c=setTimeout(reset,500);return()=>{cancelAnimationFrame(a);clearTimeout(b);clearTimeout(c);window.history.scrollRestoration=previous}},[]);
 const adminMode=canAdmin&&!studentPreview;
 function switchMode(value:boolean){setStudentPreview(value);window.localStorage.setItem("data-structure-student-preview",value?"1":"0")}
 function start(){document.getElementById("data-structure-coach")?.scrollIntoView({behavior:"smooth",block:"start"})}
 return <main className="accounting-home data-structure-home">
  <header className="accounting-top"><a href="/data-structure" className="accounting-brand"><span>資</span><div><b>資料結構課業答疑</b><small>DATA STRUCTURES</small></div></a><nav><a className="active" href="/data-structure">課業答疑</a>{adminMode&&<a href="/data-structure/admin">管理後台</a>}{canAdmin&&(studentPreview?<button className="accounting-mode-switch return" onClick={()=>switchMode(false)}>返回管理模式</button>:<button className="accounting-mode-switch" onClick={()=>switchMode(true)}>切換學生預覽</button>)}</nav></header>
  {canAdmin&&studentPreview&&<div className="accounting-preview-notice"><span>學生預覽模式</span><p>目前看到的是一般學生畫面，管理後台與測試功能已隱藏。</p><button onClick={()=>switchMode(false)}>返回管理模式</button></div>}
  <section className="accounting-hero accounting-help-hero"><div><span>資料結構 · Luna 助教</span><h1>觀念卡住了，<br/>直接問就好</h1><p>陣列、鏈結串列、堆疊、佇列、樹、圖、排序、搜尋與演算法複雜度，都能打字、貼截圖或拍照提問。</p><div><button type="button" onClick={start}>開始問 Luna 助教</button></div></div></section>
  <AccountingCoach canAdmin={adminMode} apiEndpoint="/api/data-structure/tutor" coachId="data-structure-coach" placeholder="輸入資料結構觀念、演算法、程式流程，或說明照片中哪裡看不懂…" adminHint="用學生角度接續追問，驗證回答是否真的引用資料結構教材。" enableQuestionSimulation={false}/>
 </main>
}
