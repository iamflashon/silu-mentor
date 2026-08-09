"use client";

import { useEffect, useRef, useState } from "react";
import "./plan/selection-tools.css";

type LegalArticle = { title: string; articleNo: string; hierarchy?: string; content: string; modifiedDate?: string; sourceUrl?: string };
type JudicialDecision = { id: number; court: string; year: string; caseType: string; caseNo: string; judgmentDate: string; title: string; fullText: string; excerpt: string };
type ToolPosition = { left: number; top: number; placement: "above" | "below" };
type ExplainUsage = { model: string; inputTokens: number; cachedTokens: number; outputTokens: number; durationMs: number; estimatedCostUsd: number };
const LAW_REFERENCE = /(?:中華民國)?(?:憲法|民法|刑法|行政程序法|行政訴訟法|民事訴訟法|刑事訴訟法|公司法|證券交易法|保險法|票據法|強制執行法|破產法|著作權法|商標法|公平交易法|消費者保護法|個人資料保護法)第\d+(?:條之\d+|之\d+條|條)(?:第\d+項)?/u;
const JUDICIAL_REFERENCE = /(?<court>[\p{Script=Han}]{2,20}法院)(?:民事|刑事|行政)?(?:判決|裁定)?\s*(?<year>\d{1,3})\s*年度\s*(?<caseType>[\p{Script=Han}]{1,8})\s*字\s*第\s*(?<caseNo>\d+)\s*號/u;

function isEditable(node: Node | null) {
  const element = node instanceof Element ? node : node?.parentElement;
  return Boolean(element?.closest("input, textarea, select, [contenteditable='true'], [role='textbox'], .monaco-editor, .cm-editor"));
}

export default function GlobalSelectionTools() {
  const [selectedText, setSelectedText] = useState("");
  const [lawQuery, setLawQuery] = useState("");
  const [judicialQuery, setJudicialQuery] = useState<{ court: string; year: string; caseType: string; caseNo: string } | null>(null);
  const [position, setPosition] = useState<ToolPosition | null>(null);
  const [lookup, setLookup] = useState<{ loading: boolean; article: LegalArticle | null; decision: JudicialDecision | null; error: string; explanation: string; explaining: boolean; usage: ExplainUsage | null } | null>(null);
  const rangeRef = useRef<Range | null>(null);

  function place(range: Range) {
    const rect = range.getBoundingClientRect();
    if (!rect.width && !rect.height) return;
    const compact = window.innerWidth < 760;
    const halfWidth = compact ? Math.min(170, Math.max(120, window.innerWidth / 2 - 12)) : 205;
    const left = Math.min(window.innerWidth - halfWidth, Math.max(halfWidth, rect.left + rect.width / 2));
    const above = rect.bottom + (compact ? 112 : 68) > window.innerHeight;
    setPosition({ left, top: above ? Math.max(8, rect.top - 10) : rect.bottom + 10, placement: above ? "above" : "below" });
  }

  function dismiss(clearText = false) {
    setPosition(null); rangeRef.current = null; window.getSelection()?.removeAllRanges();
    if (clearText) { setSelectedText(""); setLawQuery(""); }
  }

  useEffect(() => {
    const capture = () => {
      if (lookup) return;
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed || !selection.rangeCount || isEditable(selection.anchorNode) || isEditable(selection.focusNode)) return;
      const text = selection.toString().replace(/\s+/g, " ").trim().slice(0, 1200);
      if (text.length < 2) { setPosition(null); return; }
      const range = selection.getRangeAt(0).cloneRange();
      const match = text.replace(/\s+/g, "").match(LAW_REFERENCE);
      const judicial = text.replace(/\s+/g, "").match(JUDICIAL_REFERENCE);
      rangeRef.current = range; setSelectedText(text); setLawQuery(match?.[0] ?? "");
      setJudicialQuery(judicial?.groups ? { court: judicial.groups.court, year: judicial.groups.year, caseType: judicial.groups.caseType, caseNo: judicial.groups.caseNo } : null); place(range);
    };
    document.addEventListener("mouseup", capture);
    document.addEventListener("touchend", capture);
    return () => { document.removeEventListener("mouseup", capture); document.removeEventListener("touchend", capture); };
  }, [lookup]);

  useEffect(() => {
    if (!position) return;
    const reposition = () => rangeRef.current && place(rangeRef.current);
    window.addEventListener("scroll", reposition, true); window.addEventListener("resize", reposition);
    return () => { window.removeEventListener("scroll", reposition, true); window.removeEventListener("resize", reposition); };
  }, [position]);

  async function searchLaw() {
    if (!lawQuery) return;
    const query = lawQuery.replace(/第\d+項$/u, ""); dismiss();
    setLookup({ loading: true, article: null, decision: null, error: "", explanation: "", explaining: false, usage: null });
    const response = await fetch(`/api/legal-search?q=${encodeURIComponent(query)}&limit=5`); const data = await response.json();
    const article = (data.results?.find((item: LegalArticle & { matchType?: string }) => item.matchType === "exact") ?? data.results?.[0] ?? null) as LegalArticle | null;
    setLookup({ loading: false, article, decision: null, error: response.ok && article ? "" : data.error || "已下載的全國法規資料庫查無這條法條。", explanation: "", explaining: false, usage: null });
  }

  async function searchJudicial() {
    if (!judicialQuery) return;
    dismiss();
    setLookup({ loading: true, article: null, decision: null, error: "", explanation: "", explaining: false, usage: null });
    const q = `${judicialQuery.year}年度${judicialQuery.caseType}字第${judicialQuery.caseNo}號`;
    const response = await fetch(`/api/judicial-search?q=${encodeURIComponent(q)}&court=${encodeURIComponent(judicialQuery.court)}&year=${encodeURIComponent(judicialQuery.year)}&limit=5`);
    const data = await response.json();
    const decision = (data.results?.find((item: JudicialDecision) => item.caseType === judicialQuery.caseType && item.caseNo === judicialQuery.caseNo) ?? data.results?.[0] ?? null) as JudicialDecision | null;
    setLookup({ loading: false, article: null, decision, error: response.ok && decision ? "" : data.error || "已下載的司法院裁判資料庫查無此裁判。", explanation: "", explaining: false, usage: null });
  }

  async function openOfficialSearch(url: string) {
    const keyword = judicialQuery ? `${judicialQuery.court}${judicialQuery.year}年度${judicialQuery.caseType}字第${judicialQuery.caseNo}號` : lawQuery || selectedText;
    try { await navigator.clipboard.writeText(keyword); } catch { /* 仍可開啟官方網站手動貼上 */ }
    window.open(url, "_blank", "noopener,noreferrer");
  }

  async function explain() {
    if (!selectedText || lookup?.explaining) return;
    dismiss(); const current = lookup ?? { loading: false, article: null, decision: null, error: "", explanation: "", explaining: false, usage: null };
    setLookup({ ...current, explaining: true, error: "" });
    const reference = current.article ?? (current.decision ? { title: current.decision.court, articleNo: `${current.decision.year}年度${current.decision.caseType}字第${current.decision.caseNo}號`, content: current.decision.fullText || current.decision.excerpt } : null);
    const response = await fetch("/api/legal-explain", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ selectedText, article: reference }) }); const data = await response.json();
    setLookup((latest) => latest ? { ...latest, article: latest.article ?? (!latest.decision && response.ok ? { title: "框選內容", articleNo: "白話解釋", content: selectedText } : null), explaining: false, explanation: response.ok ? String(data.explanation || "") : "", usage: response.ok ? data.usage ?? null : null, error: response.ok ? "" : data.error || "白話解釋暫時無法完成。" } : latest);
  }

  const close = () => { setLookup(null); setSelectedText(""); setLawQuery(""); setJudicialQuery(null); };
  return <>
    {!lookup && selectedText && position && <div className={`smart-selection-bar global-selection-bar ${position.placement}`} style={{ left: position.left, top: position.top }}><span>已框選：{selectedText}</span>{judicialQuery ? <button type="button" onClick={() => void searchJudicial()}>裁判搜尋</button> : <button type="button" onClick={() => void searchLaw()} disabled={!lawQuery} title={lawQuery ? `搜尋 ${lawQuery}` : "框選內容未辨識出法規名稱與條號"}>法條搜尋</button>}<button type="button" onClick={() => void explain()}>白話解釋</button><button type="button" aria-label="關閉框選工具" onClick={() => dismiss(true)}>×</button></div>}
    {lookup && <div className="law-lookup-backdrop" role="presentation" onMouseDown={close}>
      <aside className="law-lookup-panel" role="dialog" aria-modal="true" aria-label="智能框選結果" onMouseDown={(event) => event.stopPropagation()}>
        <header><div><span>{lookup.decision ? "司法院裁判資料庫｜已下載資料" : lookup.article?.articleNo === "白話解釋" ? "AI 法律助教" : "全國法規資料庫｜已下載資料"}</span><h3>{selectedText || "框選內容"}</h3></div><button type="button" onClick={close} aria-label="關閉">×</button></header>
        {lookup.loading ? <p className="law-lookup-status">正在查詢已下載的法規／裁判資料…</p> : lookup.article ? <>
          <section><small>{lookup.article.title}{lookup.article.hierarchy ? `｜${lookup.article.hierarchy}` : ""}</small><h4>{lookup.article.articleNo}</h4><p>{lookup.article.content}</p>{lookup.article.modifiedDate && <time>資料異動日期：{lookup.article.modifiedDate}</time>}{lookup.article.articleNo !== "白話解釋" && <div className="law-usage-meta"><b>資料庫查詢</b><span>未使用 AI · 0 tokens</span><span>本次 AI 成本 NT$ 0</span></div>}</section>
          {lookup.article.articleNo !== "白話解釋" && <footer><button type="button" onClick={() => void explain()} disabled={lookup.explaining}>{lookup.explaining ? "正在解釋…" : "白話解釋"}</button>{lookup.article.sourceUrl && <a href={lookup.article.sourceUrl} target="_blank" rel="noreferrer">查看官方來源 ↗</a>}</footer>}
          {lookup.explanation && <section className="law-plain-explanation"><b>白話解釋</b><p>{lookup.explanation}</p><small>解釋以框選內容與顯示的條文為依據，不取代老師解析。</small>{lookup.usage && <div className="law-usage-meta"><b>{lookup.usage.model.replace("gpt-5.6-", "")}｜AI 白話解釋</b><span>輸入 {lookup.usage.inputTokens.toLocaleString()} · 輸出 {lookup.usage.outputTokens.toLocaleString()} · 合計 {(lookup.usage.inputTokens + lookup.usage.outputTokens).toLocaleString()} tokens</span><span>耗時 {lookup.usage.durationMs.toLocaleString()} ms · US$ {lookup.usage.estimatedCostUsd.toFixed(6)} · 約 NT$ {(lookup.usage.estimatedCostUsd * 32.5).toFixed(4)}</span></div>}</section>}
        </> : lookup.decision ? <>
          <section><small>{lookup.decision.court}｜{lookup.decision.judgmentDate || "裁判日期未載"}</small><h4>{lookup.decision.year}年度{lookup.decision.caseType}字第{lookup.decision.caseNo}號</h4><p>{lookup.decision.fullText || lookup.decision.excerpt || "平台目前只有裁判索引，尚無全文。"}</p><div className="law-usage-meta"><b>裁判資料庫查詢</b><span>未使用 AI · 0 tokens</span><span>本次 AI 成本 NT$ 0</span></div></section>
          <footer><button type="button" onClick={() => void explain()} disabled={lookup.explaining}>{lookup.explaining ? "正在解釋…" : "白話解釋"}</button><a href="https://judgment.judicial.gov.tw/FJUD/default.aspx" target="_blank" rel="noreferrer">到司法院查詢 ↗</a></footer>
          {lookup.explanation && <section className="law-plain-explanation"><b>白話解釋</b><p>{lookup.explanation}</p><small>解釋以顯示的裁判內容為依據，不取代老師解析。</small>{lookup.usage && <div className="law-usage-meta"><b>{lookup.usage.model.replace("gpt-5.6-", "")}｜AI 白話解釋</b><span>輸入 {lookup.usage.inputTokens.toLocaleString()} · 輸出 {lookup.usage.outputTokens.toLocaleString()} · 合計 {(lookup.usage.inputTokens + lookup.usage.outputTokens).toLocaleString()} tokens</span><span>耗時 {lookup.usage.durationMs.toLocaleString()} ms · US$ {lookup.usage.estimatedCostUsd.toFixed(6)} · 約 NT$ {(lookup.usage.estimatedCostUsd * 32.5).toFixed(4)}</span></div>}</section>}
        </> : <div className="law-lookup-status error"><p>{lookup.error}</p>{judicialQuery && <small>{judicialQuery.court}｜{judicialQuery.year}年度｜{judicialQuery.caseType}字｜第{judicialQuery.caseNo}號</small>}<div className="official-search-fallback"><b>已整理並複製搜尋關鍵字</b><span>選擇官方網站後，可直接貼入搜尋欄。</span><div><button type="button" onClick={() => void openOfficialSearch("https://law.moj.gov.tw/")}>全國法規資料庫 ↗</button><button type="button" onClick={() => void openOfficialSearch("https://judgment.judicial.gov.tw/FJUD/default.aspx")}>司法院裁判書 ↗</button><button type="button" onClick={() => void openOfficialSearch("https://cons.judicial.gov.tw/judsearch.aspx?fid=46")}>憲法法庭 ↗</button></div></div></div>}
        {lookup.error && lookup.article && <p className="law-lookup-status error">{lookup.error}</p>}
      </aside>
    </div>}
  </>;
}
