import type { Metadata } from "next";
import "../../../study-room.css";
import "./notebook-modes.css";

export const metadata: Metadata = { title: "學霸讀書室｜彭狸行政法" };

const modes = [
  ["圖", "概念地圖", "整理主題、爭點、法條與實務見解的上下及橫向關係。", "/teachers/pengli/coach?mode=map", "建立地圖"],
  ["白", "白話解釋", "先用日常例子理解，再回到考試需要的法律用語。", "/teachers/pengli/coach?mode=plain", "開始理解"],
  ["卡", "複習小卡", "混合定義、因果、比較與案例應用，逐張主動回想。", "/teachers/pengli/coach?mode=flashcards", "開始複習"],
  ["比", "見解比較", "整理學說與實務差異、理由及考場上的作答位置。", "/teachers/pengli/coach?mode=compare", "比較見解"],
  ["考", "模擬測驗", "依彭狸老師教材風格練選擇判斷與申論破題。", "/teachers/pengli/coach?mode=mock", "開始測驗"],
  ["補", "弱點分析", "根據練習紀錄找出最需要補強的爭點與教材位置。", "/teachers/pengli/coach?mode=weakness", "診斷弱點"],
  ["說", "費曼教學", "用自己的話教給我聽，再檢查遺漏與過度簡化。", "/teachers/pengli/coach?mode=teachback", "開始說明"],
  ["程", "考前計畫", "依剩餘時間、強弱主題與可用時段安排衝刺進度。", "/teachers/pengli/coach?mode=plan", "安排計畫"],
  ["問", "老師問答", "沿著教材問題意識追問，練習定性、合法性與救濟。", "/teachers/pengli/coach?mode=guide", "開始問答"],
] as const;

export default function PengliStudyRoom(){return <main className="study-room legal">
  <header className="study-room-top"><a className="study-room-brand" href="/teachers/pengli"><span>彭</span><div><b>學霸讀書室</b><small>PENGLI · ADMINISTRATIVE LAW</small></div></a><nav><a href="/teachers/pengli">返回專區</a><a href="/teachers/pengli/notes">我的筆記</a></nav></header>
  <section className="study-room-head"><span>彭狸老師 · 行政法考點演習書（二版）</span><h1>學霸讀書室</h1><p>沿著老師的問題意識掌握爭點、法條與實務見解，再用主動回想和申論練習檢查自己是否真正理解。</p></section>
  <div className="study-room-body">
    <section className="study-room-connect" aria-label="學習資料入口"><a href="/teachers/pengli/read"><b>八大主題教材</b><span>依書籍目錄選擇主題，直接閱讀站內重新排版內容。</span></a><a href="/teachers/pengli/coach?mode=recall"><b>考點練習</b><span>從基本判斷到追問，一次完成一個考點。</span></a><a href="/teachers/pengli/coach?mode=essay"><b>申論演練</b><span>依爭點、規範、涵攝與結論檢查作答架構。</span></a></section>
    <div className="study-room-section-head"><h2>學習工具</h2><p>全部依彭狸老師教材內容進行</p></div>
    <section className="study-room-modes notebook-modes">{modes.map(([icon,title,description,href,action])=><a className="study-mode" href={href} key={title}><i>{icon}</i><h3>{title}</h3><p>{description}</p><b>{action} →</b></a>)}</section>
    <section className="study-room-flow"><h2>從理解到完整作答</h2><ol><li>選擇行政法主題與教材範圍</li><li>先說出自己的理解與判斷</li><li>核對爭點、法條及實務見解</li><li>進入申論架構練習並回頭補強</li></ol></section>
  </div>
</main>}
