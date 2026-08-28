import type { Metadata } from "next";
import Link from "next/link";
import PengliCover from "./PengliCover";
import "./pengli.css";

export const metadata: Metadata = {
  title: "彭狸老師行政法考點衝刺",
  description: "以考點、解題架構與申論演練完成行政法考前衝刺。",
};

const themes = [
  ["01", "行政法理論基礎與行政組織法", "原理原則、行政裁量、公法上權利與行政組織"],
  ["02", "行政處分", "定性、效力、合法性、廢棄與附款"],
  ["03", "行政契約與行政命令", "行政契約爭議、法規命令與救濟"],
  ["04", "行政罰法", "處罰原則、責任、行為數、不法利得與時效"],
  ["05", "行政執行法", "執行名義、金錢義務、即時強制與救濟"],
  ["06", "訴願法與行政訴訟法", "訴訟類型、暫時權利保護與都市計畫審查"],
  ["07", "國家賠償法與損失補償", "公務員責任、公共設施與徵收補償"],
  ["08", "新進實務見解整理", "性平、性騷擾、警職法與近期重要實務"],
] as const;

export default function PengliTeacherPage() {
  return <main className="pengli-page">
    <nav className="pengli-topbar" aria-label="頁面導覽">
      <Link href="/" className="pengli-brand">iBrain Pedia X</Link>
      <div><span>法律類</span><b>行政法</b></div>
      <div className="pengli-top-actions">
        <Link href="/teachers/pengli/coach">繼續 AI 對話</Link>
        <Link href="/teachers/pengli/notes">我的筆記</Link>
      </div>
    </nav>

    <section className="pengli-hero">
      <div className="pengli-hero-copy">
        <div className="pengli-kicker"><span>彭狸老師專區</span><i>2026 二版</i></div>
        <h1>行政法考點<br/><em>考前衝刺</em></h1>
        <p>不是把整本書重新讀一次，而是沿著老師的問題意識，完成考點複習、破題判斷與申論演練。</p>
        <div className="pengli-hero-actions">
          <a href="#curriculum">任選主題試問</a>
          <a href="#curriculum" className="primary">查看 8 大主題</a>
        </div>
        <dl className="pengli-hero-stats">
          <div><dt>8</dt><dd>大主題</dd></div>
          <div><dt>10</dt><dd>免費提問</dd></div>
          <div><dt>90</dt><dd>天衝刺規劃</dd></div>
        </dl>
      </div>
      <div className="pengli-book-stage">
        <div className="pengli-book-halo" aria-hidden="true" />
        <PengliCover className="pengli-hero-managed-cover" />
        <div className="pengli-teacher-note"><small>AUTHOR</small><strong>彭狸</strong><span>臺大法律研究所公法組</span></div>
      </div>
    </section>

    <section className="pengli-workspace" id="curriculum">
      <header>
        <div><span>LEARNING PATH</span><h2>八大主題學習路徑</h2></div>
        <p>八大主題全部開放任選；選定主題進入 AI 教練，可免費提問 10 次。</p>
      </header>
      <div className="pengli-layout">
        <div className="pengli-theme-list">
          {themes.map(([number, title, summary]) => <article className="available" key={number}>
            <span>{number}</span>
            <div><h3>{title}</h3><p>{summary}</p></div>
            <Link href={`/teachers/pengli/coach?topic=${encodeURIComponent(title)}`} aria-label={`選擇主題：${title}`}>選擇</Link>
          </article>)}
        </div>
        <aside className="pengli-progress-card">
          <span>免費體驗方式</span>
          <strong>任選一個主題</strong>
          <div className="pengli-progress"><i style={{width:"0%"}} /></div>
          <small>首次實際提問時啟用 10 次</small>
          <hr/>
          <ul><li>八大主題皆可選擇</li><li>只依老師教材範圍回答</li><li>未找到對應書頁不扣次</li></ul>
          <a href="#curriculum">從八大主題中選擇</a>
        </aside>
      </div>
    </section>

    <footer className="pengli-footer"><Link href="/">返回 iBrain Pedia X 首頁</Link><span>法律類｜彭狸老師行政法專區</span></footer>
  </main>;
}
