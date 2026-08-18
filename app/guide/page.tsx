const LAW_HOME = "https://silu-mentor.iamflashon.chatgpt.site/law";

const features = [
  { icon: "01", title: "今日學習計畫", label: "知道今天先做什麼", text: "首頁會依你的進度安排今日任務。完成後留下學習接續點，下一次回來可以接著學，不必重新摸索。" },
  { icon: "02", title: "練真題", label: "先想，再和 AI 對話", text: "一試選擇題不只公布對錯；你可以說明選項理由，讓真題教練針對你的判斷一步步追問。" },
  { icon: "03", title: "寫申論", label: "從審題到擬答", text: "二試申論可選題、進行引導練習，先整理爭點、規範與涵攝，再決定是否進入正式作答與 AI 批改。" },
  { icon: "04", title: "找爭點", label: "不會抓爭點也能開始", text: "把題目或自己的題庫交給平台，先列出你想到的爭點，再請 AI 逐項分析缺漏與答題方向。" },
  { icon: "05", title: "整摘要", label: "把教材變成可複習內容", text: "上傳教材或圖片後，查看原文與 AI 摘要。摘要可以分科目、資料夾整理，右側直接閱讀最後選取的摘要。" },
  { icon: "06", title: "我的筆記", label: "把重要內容留下來", text: "看到重要回答、法條或題目時，可快速收藏，或請 AI 整理成筆記；司律與醫檢師筆記分開保存。" },
];

export default function GuidePage() {
  return (
    <main className="guide-page" data-no-navigation-feedback>
      <header className="guide-header">
        <a href={LAW_HOME} className="guide-brand"><span>律</span><div><b>司律備考</b><small>AI STUDY GUIDE</small></div></a>
        <a href={LAW_HOME} className="guide-back">← 回首頁</a>
      </header>

      <section className="guide-hero">
        <span className="guide-kicker">START HERE</span>
        <h1>第一次使用，先看這裡</h1>
        <p>這不是只會回答問題的聊天機器人，而是一個會記住你的進度、協助你拆題，並把重要內容留下來的司律學習平台。</p>
        <div className="guide-hero-actions"><a href={LAW_HOME} className="guide-primary">回到首頁開始</a><a href="#selection" className="guide-secondary">先看框選功能</a></div>
      </section>

      <section className="guide-section" aria-labelledby="guide-features-title">
        <div className="guide-section-heading"><span>HOW TO USE</span><h2 id="guide-features-title">六個主要入口，照你的需要使用</h2><p>不用一次全部學會；今天想做題就進練真題，想整理教材就進整摘要。</p></div>
        <div className="guide-feature-grid">{features.map((feature) => <article className="guide-feature-card" key={feature.icon}><span>{feature.icon}</span><h3>{feature.title}</h3><b>{feature.label}</b><p>{feature.text}</p></article>)}</div>
      </section>

      <section className="guide-section guide-selection-section" id="selection" aria-labelledby="selection-title">
        <div className="guide-section-heading"><span>SMART SELECTION</span><h2 id="selection-title">框選文字，就能直接查法條或請 AI 白話解釋</h2><p>在真正的學習內容上拖曳選取文字，工具列才會出現；一般按鈕、標題與操作卡片不會再跳出來。</p></div>
        <div className="guide-selection-grid">
          <article><strong>可以框選的地方</strong><ul><li>首頁 AI 對話訊息</li><li>一試／二試考題與解析</li><li>申論題目、老師擬答與 AI 批改內容</li><li>我的筆記內容</li></ul></article>
          <article><strong>框選後可以做什麼</strong><ul><li><b>法條搜尋</b>：辨識完整法規名稱與條號後，查詢已同步的法規資料。</li><li><b>白話解釋</b>：看不懂法條、法律概念或一段解析時，請 AI 依目前內容拆解。</li><li><b>收藏／整理筆記</b>：把原文或整理後的重點留下，之後回到筆記複習。</li></ul></article>
        </div>
        <p className="guide-tip"><b>小提醒：</b>框選法條時，盡量包含「法規名稱＋第幾條」；若只選到片段，法條搜尋可能無法判定，但仍可使用白話解釋。</p>
      </section>

      <section className="guide-section guide-flow-section" aria-labelledby="flow-title">
        <div className="guide-section-heading"><span>RECOMMENDED FLOW</span><h2 id="flow-title">建議的學習順序</h2></div>
        <div className="guide-flow"><div><b>1</b><strong>先看今日任務</strong><span>知道今天的重點</span></div><i>→</i><div><b>2</b><strong>練一題真題</strong><span>先說出自己的理由</span></div><i>→</i><div><b>3</b><strong>框選不懂的地方</strong><span>查法條或請 AI 解釋</span></div><i>→</i><div><b>4</b><strong>整理成筆記</strong><span>留下下次接續點</span></div></div>
      </section>

      <footer className="guide-footer"><p>先從一個問題開始就好。平台會保存你的學習紀錄，陪你逐步完成司律備考。</p><a href={LAW_HOME}>開始今天的學習 →</a></footer>
    </main>
  );
}
