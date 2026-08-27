import type { Metadata } from "next";
import Link from "next/link";
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

const samplePoints = [
  {
    number: "01",
    title: "公私法區分",
    question: "事件應由普通法院或行政法院審判，判斷起點是什麼？",
    takeaway: "先區分法規性質與事件性質，再以請求權基礎檢查審判權。",
    label: "基礎定位",
  },
  {
    number: "02",
    title: "法律保留原則",
    question: "限制人民權利時，何時必須有法律或法律授權？",
    takeaway: "掌握層級化法律保留，並辨認地方自治條例能否成為規範依據。",
    label: "國考高頻",
  },
  {
    number: "03",
    title: "明確性原則",
    question: "法律概念有解釋空間，就一定違反明確性原則嗎？",
    takeaway: "從可理解、可預見及可由司法審查三個方向建立判斷架構。",
    label: "免費試學",
  },
] as const;

export default function PengliTeacherPage() {
  return <main className="pengli-page">
    <nav className="pengli-topbar" aria-label="頁面導覽">
      <Link href="/">iBrain Pedia X</Link>
      <div><span>法律類</span><b>行政法</b></div>
    </nav>

    <section className="pengli-hero">
      <div className="pengli-hero-copy">
        <div className="pengli-kicker"><span>彭狸老師專區</span><i>2026 二版</i></div>
        <h1>行政法考點<br/><em>考前衝刺</em></h1>
        <p>不是把整本書重新讀一次，而是沿著老師的問題意識，完成考點複習、破題判斷與申論演練。</p>
        <div className="pengli-hero-actions">
          <a href="#free-trial">先免費試學</a>
          <a href="#curriculum" className="primary">查看 8 大主題</a>
        </div>
        <dl className="pengli-hero-stats">
          <div><dt>8</dt><dd>大主題</dd></div>
          <div><dt>3</dt><dd>免費考點</dd></div>
          <div><dt>90</dt><dd>天衝刺規劃</dd></div>
        </dl>
      </div>
      <div className="pengli-book-stage">
        <div className="pengli-book-halo" aria-hidden="true" />
        <img src="/teachers/pengli-administrative-law-cover.webp" alt="行政法考點（考前衝刺）演習書透明書封" />
        <div className="pengli-teacher-note"><small>AUTHOR</small><strong>彭狸</strong><span>臺大法律研究所公法組</span></div>
      </div>
    </section>

    <section className="pengli-workspace" id="curriculum">
      <header>
        <div><span>LEARNING PATH</span><h2>八大主題學習路徑</h2></div>
        <p>免費體驗開放主題 1 的前三個考點；完整專區將依書籍順序逐步解鎖。</p>
      </header>
      <div className="pengli-layout">
        <div className="pengli-theme-list">
          {themes.map(([number, title, summary], index) => <article className={index === 0 ? "active" : "locked"} key={number}>
            <span>{number}</span>
            <div><h3>{title}</h3><p>{summary}</p></div>
            <b aria-label={index === 0 ? "可試學" : "尚未解鎖"}>{index === 0 ? "開始" : "鎖定"}</b>
          </article>)}
        </div>
        <aside className="pengli-progress-card">
          <span>我的衝刺進度</span>
          <strong>免費體驗</strong>
          <div className="pengli-progress"><i style={{width:"12%"}} /></div>
          <small>0／3 個免費考點完成</small>
          <hr/>
          <ul><li>考點閱讀與老師提醒</li><li>破題步驟練習</li><li>申論架構自我檢查</li></ul>
          <a href="#free-trial">開始第一個考點</a>
        </aside>
      </div>
    </section>

    <section className="pengli-trial" id="free-trial">
      <header><span>FREE TRIAL</span><h2>免費試學：先練三個基礎考點</h2><p>每個考點都從一個問題開始，不先把答案整段塞給你。</p></header>
      <div className="pengli-trial-grid">
        {samplePoints.map((point) => <article key={point.number}>
          <div><span>{point.label}</span><b>{point.number}</b></div>
          <h3>{point.title}</h3>
          <p>{point.question}</p>
          <details>
            <summary>查看本題學習重點</summary>
            <p>{point.takeaway}</p>
          </details>
          <Link href={`/teachers/pengli/coach?topic=${encodeURIComponent(point.title)}`}>進入 AI 教練<b aria-hidden="true">→</b></Link>
        </article>)}
      </div>
    </section>

    <section className="pengli-access" id="access-plan">
      <div><span>FULL ACCESS</span><h2>完整專區開通規劃</h2><p>完整內容、使用期限與付款方式確認後，將在這裡直接開通。</p></div>
      <ul><li>八大主題完整考點</li><li>考點直擊題與破題方法</li><li>申論擬答比較與批改</li><li>個人弱點與進度紀錄</li></ul>
      <button type="button" disabled>方案準備中</button>
    </section>

    <footer className="pengli-footer"><Link href="/">返回 iBrain Pedia X 首頁</Link><span>法律類｜彭狸老師行政法專區</span></footer>
  </main>;
}
