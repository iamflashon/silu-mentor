import type { Metadata } from "next";
import StudyRoomStudio from "./StudyRoomStudio";
import "../../../study-room.css";
import "./studio.css";

export const metadata: Metadata = { title: "學霸讀書室｜彭狸行政法" };

export default function PengliStudyRoom(){return <main className="study-room legal">
  <header className="study-room-top"><a className="study-room-brand" href="/teachers/pengli"><span>彭</span><div><b>學霸讀書室</b><small>PENGLI · ADMINISTRATIVE LAW</small></div></a><nav><a href="/teachers/pengli">返回專區</a><a href="/teachers/pengli/notes">我的筆記</a></nav></header>
  <section className="study-room-head"><span>彭狸老師 · 行政法考點演習書（二版）</span><h1>學霸讀書室</h1><p>不是只有問答。選擇學習範本，把教材轉成讀書指南、逐題測驗、重點排序、概念拆解、模擬考或費曼練習。</p></section>
  <StudyRoomStudio />
</main>}
