export default function MedtechHome() {
  return <main className="medtech-home">
    <header className="medtech-top" data-no-navigation-feedback><a href="/medtech" className="medtech-brand"><span>醫</span><div><b>醫檢師備考</b><small>MEDICAL TECHNOLOGIST</small></div></a><nav><a href="/medtech" className="active">首頁</a><a href="/medtech/practice">練國考題</a><a href="/platform">切換類科</a></nav></header>
    <section className="medtech-hero"><div><span>臨床病毒學 · 正式題庫</span><h1>把厚重教材，變成每天能完成的練習。</h1><p>依教材原稿建立題目、選項與答案來源。醫檢題庫與司律完全分開，先作答，交卷後再核對教材答案。</p><div className="medtech-hero-actions" data-no-navigation-feedback><a href="/medtech/practice">開始隨機 30 題</a><a href="#modes">查看練習模式</a></div></div><aside><small>已匯入正式題庫</small><b>1,484</b><span>題 · 臨床病毒學</span><dl><div><dt>來源</dt><dd>臨床病毒學（下）</dd></div><div><dt>狀態</dt><dd>教材原稿答案</dd></div><div><dt>作答</dt><dd>隨機抽題／整回交卷</dd></div></dl></aside></section>
    <section className="medtech-modes" id="modes"><article><span>01</span><h2>章節刷題</h2><p>依總論、DNA 病毒、RNA 病毒與檢驗方法練習。</p><small>下一階段開放</small></article><article className="ready"><span>02</span><h2>隨機模考</h2><p>每回從 1,484 題正式題庫隨機抽取 30 題，交卷後核對答案。</p><a href="/medtech/practice" data-no-navigation-feedback>現在開始 →</a></article><article><span>03</span><h2>錯題複習</h2><p>依錯題考點回到教材內容，建立個人複習清單。</p><small>下一階段開放</small></article></section>
  </main>;
}
