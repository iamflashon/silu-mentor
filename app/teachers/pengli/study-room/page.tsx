import type { Metadata } from "next";
import "../../../study-room.css";

export const metadata: Metadata = { title: "學霸讀書室｜彭狸行政法" };

const modes = [
  ["重", "考試重點", "依八大主題整理問題意識、爭點與作答順序。", "/teachers/pengli/coach?mode=guide", "選擇主題"],
  ["讀", "考前速讀", "將指定主題整理為考前可快速複習的爭點與判斷脈絡。", "/teachers/pengli/coach?mode=review", "開始整理"],
  ["想", "主動回想", "一次回答一個問題，回答後再核對教材與老師提醒。", "/teachers/pengli/coach?mode=recall", "開始練習"],
  ["說", "教給我聽", "用自己的話說明法律概念，再檢查遺漏與過度簡化之處。", "/teachers/pengli/coach?mode=teachback", "開始說明"],
  ["補", "弱點分析", "從練習與筆記找出易混淆爭點，回到對應教材補強。", "/teachers/pengli/notes?view=review", "查看弱點"],
] as const;

export default function PengliStudyRoom(){return <main className="study-room legal">
  <header className="study-room-top"><a className="study-room-brand" href="/teachers/pengli"><span>彭</span><div><b>學霸讀書室</b><small>PENGLI · ADMINISTRATIVE LAW</small></div></a><nav><a href="/teachers/pengli">返回專區</a><a href="/teachers/pengli/notes">我的筆記</a></nav></header>
  <section className="study-room-head"><span>彭狸老師 · 行政法考點演習書（二版）</span><h1>學霸讀書室</h1><p>沿著老師的問題意識掌握爭點、法條與實務見解，再用主動回想和申論練習檢查自己是否真正理解。</p></section>
  <div className="study-room-body">
    <section className="study-room-connect" aria-label="學習資料入口"><a href="/teachers/pengli#curriculum"><b>八大主題教材</b><span>依書籍目錄選擇主題，對照實際教材頁碼。</span></a><a href="/teachers/pengli/coach?mode=recall"><b>考點練習</b><span>從基本判斷到追問，一次完成一個考點。</span></a><a href="/teachers/pengli/coach?mode=essay"><b>申論演練</b><span>依爭點、規範、涵攝與結論檢查作答架構。</span></a></section>
    <div className="study-room-section-head"><h2>今天想怎麼讀？</h2><p>回答均以彭狸老師教材為主要範圍</p></div>
    <section className="study-room-modes">{modes.map(([icon,title,description,href,action])=><a className="study-mode" href={href} key={title}><i>{icon}</i><h3>{title}</h3><p>{description}</p><b>{action} →</b></a>)}</section>
    <section className="study-room-flow"><h2>從理解到完整作答</h2><ol><li>選擇行政法主題與教材範圍</li><li>先說出自己的理解與判斷</li><li>核對爭點、法條及實務見解</li><li>進入申論架構練習並回頭補強</li></ol></section>
  </div>
</main>}
