import type { Metadata } from "next";

export const metadata: Metadata = { title: "學章節｜中級會計課業答疑" };

const chapters = [
  ["01", "財務報導之觀念架構", "會計定義、編製基礎、基本假設與品質特性"],
  ["02", "財務報表的表達", "財務狀況表、綜合損益表、權益變動表與附註"],
  ["03", "複利及年金", "現值、終值、隱含利率與攤銷表"],
  ["04", "收入認列與衡量", "客戶合約五步驟、合約修改與特殊收入議題"],
  ["05", "現金及應收帳款", "銀行調節、後續衡量、票據與融資除列"],
  ["06", "存貨", "成本流動、淨變現價值、錯誤影響與估計方法"],
  ["07", "營業用資產", "原始認列、利息資本化、折舊與減損"],
  ["08", "無形資產、投資性不動產及生物資產", "辨認、衡量、攤銷與後續處理"],
  ["09", "金融工具", "分類、衡量、減損與除列"],
  ["10", "負債", "流動負債、金融負債、負債準備與或有事項"],
  ["11", "股東權益與每股盈餘", "權益交易、保留盈餘與基本／稀釋每股盈餘"],
  ["12", "租賃", "承租人與出租人的認列及衡量"],
  ["13", "員工福利", "短期福利、確定提撥與確定福利計畫"],
  ["14", "所得稅", "當期所得稅、遞延所得稅與稅率變動"],
  ["15", "現金流量表", "營業、投資、籌資活動與編製方法"],
  ["16", "會計變動及錯誤更正", "政策、估計變動與前期錯誤"],
  ["17", "財務報表分析", "比率、趨勢與整體財務分析"],
] as const;

export default function AccountingChapters() {
  return <main className="accounting-chapters-page">
    <header className="accounting-top"><a href="/accounting" className="accounting-brand"><span>中</span><div><b>中級會計課業答疑</b><small>SMART BOOK</small></div></a><nav><a href="/accounting">課業答疑</a><a className="active" href="/accounting/chapters">學章節</a><a href="/accounting/admin">管理後台</a></nav></header>
    <section className="accounting-chapters-head"><span>《中級會計學霸》上、下冊</span><h1>17 章中會智能書</h1><p>章名依教材目錄建立；教材完成索引後，點選章節即可限定該章向 AI 提問並顯示實際引用。</p></section>
    <section className="accounting-chapter-grid">{chapters.map(([number,title,description])=><a href={`/accounting#accounting-coach`} key={number}><small>CHAPTER {number}</small><h2>{title}</h2><p>{description}</p><b>進入章節學習 →</b></a>)}</section>
  </main>;
}
