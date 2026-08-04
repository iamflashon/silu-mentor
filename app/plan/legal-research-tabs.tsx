"use client";

import { useState } from "react";
import { JudicialSearch } from "./judicial-search";
import { LegalSearch } from "./legal-search";

type ResearchTab = "all" | "laws" | "judicial";

export function LegalResearchTabs() {
  const [tab, setTab] = useState<ResearchTab>("all");
  const [lawCount, setLawCount] = useState<number | null>(null);
  const [judicialCount, setJudicialCount] = useState<number | null>(null);

  const countLabel = (count: number | null) => count === null ? "" : ` ${count}`;

  return <section className="legal-research-shell" aria-label="法規與裁判搜尋">
    <nav className="legal-research-tabs" aria-label="搜尋資料類型">
      <button type="button" className={tab === "all" ? "active" : ""} aria-selected={tab === "all"} onClick={() => setTab("all")}>全部</button>
      <button type="button" className={tab === "laws" ? "active" : ""} aria-selected={tab === "laws"} onClick={() => setTab("laws")}>全國法規{countLabel(lawCount)}</button>
      <button type="button" className={tab === "judicial" ? "active" : ""} aria-selected={tab === "judicial"} onClick={() => setTab("judicial")}>司法院裁判{countLabel(judicialCount)}</button>
    </nav>

    {tab === "all" && <div className="legal-research-overview">
      <header><p>LEGAL RESEARCH</p><h2>要查法條，還是找裁判？</h2><span>兩種官方資料分開搜尋，結果不會再互相往下擠。</span></header>
      <div>
        <button type="button" onClick={() => setTab("laws")}>
          <span>01</span><strong>全國法規</strong><p>查法規名稱、條號與關鍵字，閱讀完整現行條文。</p><b>{lawCount === null ? "開始查法條 →" : `查看 ${lawCount} 筆搜尋結果 →`}</b>
        </button>
        <button type="button" onClick={() => setTab("judicial")}>
          <span>02</span><strong>司法院裁判</strong><p>依案號、法院、年度或全文關鍵字搜尋已下載裁判。</p><b>{judicialCount === null ? "開始找裁判 →" : `查看 ${judicialCount} 筆搜尋結果 →`}</b>
        </button>
      </div>
    </div>}

    <div className={tab === "laws" ? "research-panel active" : "research-panel"} aria-hidden={tab !== "laws"}>
      <LegalSearch onResultCount={setLawCount} />
    </div>
    <div className={tab === "judicial" ? "research-panel active" : "research-panel"} aria-hidden={tab !== "judicial"}>
      <JudicialSearch onResultCount={setJudicialCount} />
    </div>
  </section>;
}
