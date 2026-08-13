import Link from "next/link";

export default function MedtechHome() {
  return <main className="medtech-home">
    <header className="medtech-top"><Link href="/platform" className="medtech-brand"><span>醫</span><div><b>醫檢師備考</b><small>MEDICAL TECHNOLOGIST</small></div></Link><nav><Link href="/medtech" className="active">首頁</Link><Link href="/medtech/practice">練國考題</Link><Link href="/platform">切換類科</Link></nav></header>
    <section className="medtech-hero"><div><span>臨床病毒學 · 第一階段</span><h1>把厚重教材，變成每天能完成的練習。</h1><p>依教材原稿建立題目、答案與章節來源。老師內容與系統補充分開呈現，先作答，再看依據。</p><div className="medtech-hero-actions"><Link href="/medtech/practice">開始 30 題測試</Link><a href="#modes">查看練習模式</a></div></div><aside><small>本次測試樣本</small><b>30</b><span>題 · 模擬考第 1 回</span><dl><div><dt>來源</dt><dd>臨床病毒學（下）</dd></div><div><dt>狀態</dt><dd>教材答案待校對</dd></div><div><dt>作答</dt><dd>逐題／整回交卷</dd></div></dl></aside></section>
    <section className="medtech-modes" id="modes"><article><span>01</span><h2>章節刷題</h2><p>依總論、DNA 病毒、RNA 病毒與檢驗方法練習。</p><small>下一階段開放</small></article><article className="ready"><span>02</span><h2>全真模考</h2><p>先完成 30 題測試樣本，交卷後查看分數與弱點。</p><Link href="/medtech/practice">現在開始 →</Link></article><article><span>03</span><h2>錯題複習</h2><p>依錯題考點回到教材內容，建立個人複習清單。</p><small>下一階段開放</small></article></section>
    <section className="medtech-separation"><div><span>獨立類科空間</span><h2>不與司律教材、題庫或學習紀錄混用</h2></div><p>醫檢師使用自己的首頁、網址、教學語氣與題目資料；管理員仍可從同一後台切換類科管理。</p></section>
  </main>;
}
