import type { Metadata } from "next";
import AccountingCoach from "./AccountingCoach";

export const metadata: Metadata = { title: "中級會計備考", description: "中級會計學真題、計算、分錄與準則的 AI 備考平台。" };

const tabs = [
  { label: "練題庫", detail: "依章節、年度與弱點練習歷屆題", href: "/accounting/practice", mark: "01" },
  { label: "引導學習", detail: "逐步拆題、計算、分錄與核對", href: "#accounting-coach", mark: "02" },
  { label: "學章節", detail: "沿著 17 章教材建立完整觀念", href: "/accounting/chapters", mark: "03" },
  { label: "整觀念", detail: "比較準則、衡量與易錯差異", href: "#accounting-coach", mark: "04" },
];

const books = [
  { type: "核心教材", title: "中級會計學霸（上）", use: "第 1–9 章｜觀念、範例與實作" },
  { type: "核心教材", title: "中級會計學霸（下）", use: "第 10–17 章｜觀念、範例與實作" },
  { type: "章節題庫", title: "會研所中級會計學題庫制霸", use: "18 章題庫｜依章節拆題練習" },
  { type: "申論訓練", title: "中級會計學申論題完全制霸", use: "計算、分錄與申論作答" },
  { type: "年度攻略", title: "泓觀稱霸中級會計學 114 年解題全攻略", use: "年度試題、配分與完整解答" },
];

export default function AccountingHome() {
  return <main className="accounting-home">
    <header className="accounting-top" data-no-navigation-feedback><a href="/accounting" className="accounting-brand"><span>中</span><div><b>中級會計備考</b><small>INTERMEDIATE ACCOUNTING</small></div></a><nav><a className="active" href="/accounting">首頁</a><a href="/accounting/practice">練真題</a><a href="/accounting/chapters">學章節</a><a href="/accounting/admin">管理後台</a><a href="/platform">切換類科</a></nav></header>
    <section className="accounting-hero"><div><span>中級會計學 · AI 備考平台</span><h1>不是只記答案，<br />而是看懂每一步怎麼算</h1><p>從會計準則、分類判斷、衡量，到計算與分錄，建立可以帶進考場的解題流程。</p><div><a href="#accounting-coach">開始問中會 AI</a><a href="/accounting/practice">進入真題練習</a></div></div><aside><span>解題順序</span><ol><li><b>01</b>確認題目要求</li><li><b>02</b>列出已知條件</li><li><b>03</b>選用準則與公式</li><li><b>04</b>計算、分錄、核對</li></ol></aside></section>
    <nav className="accounting-tabs" aria-label="中級會計學習功能">{tabs.map((tab) => <a href={tab.href} key={tab.label}><span>{tab.mark}</span><div><b>{tab.label}</b><small>{tab.detail}</small></div></a>)}</nav>
    <section className="accounting-books" id="accounting-books"><header><div><span>教材架構</span><h2>五本書各自負責一個學習任務</h2></div><p>教材與題庫分開拆解，AI 引用時顯示實際書名、章節與頁碼。</p></header><div>{books.map((book) => <article key={book.title}><span>{book.type}</span><h3>{book.title}</h3><p>{book.use}</p></article>)}</div></section>
    <AccountingCoach />
  </main>;
}
