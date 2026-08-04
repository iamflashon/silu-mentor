"use client";
import { FormEvent, useState } from "react";
type JudicialResult = { id: number; jid: string; court: string; year: string; caseType: string; caseNo: string; judgmentDate: string; title: string; fullText: string; excerpt: string };
type JudicialSearchResponse = { results?: JudicialResult[]; availableTotal?: number; error?: string };
const SEARCH_EXAMPLES = [
  { label: "完整案號", query: "最高法院108年度台上字第1264號", court: "", year: "" },
  { label: "爭點關鍵字", query: "不作為犯", court: "", year: "" },
  { label: "法院＋年度", query: "", court: "最高法院", year: "108" },
];
function escapeRegExp(value: string) { return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
function Highlight({ text, query }: { text: string; query: string }) { const term = query.trim(); if (term.length < 2) return <>{text}</>; const matcher = new RegExp(`(${escapeRegExp(term)})`, "gi"); return <>{text.split(matcher).map((part, index) => part.toLowerCase() === term.toLowerCase() ? <mark className="search-hit" key={index}>{part}</mark> : <span key={index}>{part}</span>)}</>; }
export function JudicialSearch({ onResultCount }: { onResultCount?: (count: number) => void }) {
  const [query, setQuery] = useState(""); const [court, setCourt] = useState(""); const [year, setYear] = useState("");
  const [results, setResults] = useState<JudicialResult[]>([]); const [expanded, setExpanded] = useState<number | null>(null);
  const [loading, setLoading] = useState(false); const [searched, setSearched] = useState(false); const [error, setError] = useState(""); const [availableTotal, setAvailableTotal] = useState<number | null>(null);
  async function runSearch(nextQuery = query, nextCourt = court, nextYear = year) { setLoading(true); setError(""); setSearched(true); try { const response = await fetch(`/api/judicial-search?q=${encodeURIComponent(nextQuery.trim())}&court=${encodeURIComponent(nextCourt.trim())}&year=${encodeURIComponent(nextYear.trim())}`); const data = await response.json() as JudicialSearchResponse; if (!response.ok) throw new Error(data.error ?? "裁判搜尋失敗"); setResults(data.results ?? []); setAvailableTotal(data.availableTotal ?? null); onResultCount?.((data.results ?? []).length); } catch (reason) { setResults([]); onResultCount?.(0); setError(reason instanceof Error ? reason.message : "裁判搜尋失敗"); } finally { setLoading(false); } }
  async function search(event?: FormEvent) { event?.preventDefault(); await runSearch(); }
  return <section className="legal-search-panel judicial-search-panel" aria-label="司法院裁判搜尋">
    <div className="legal-search-head"><div><p>JUDICIAL DECISION SEARCH</p><h2>司法院裁判搜尋</h2><span>搜尋已下載的司法院公開裁判；可用案號、法院或全文關鍵字查找。</span></div><strong>真實資料</strong></div>
    <form className="judicial-search-form" onSubmit={search}><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="案號或關鍵字，例如：損害賠償、詐欺" aria-label="裁判關鍵字" /><input value={court} onChange={(e) => setCourt(e.target.value)} placeholder="法院（可不填）" aria-label="法院" /><input value={year} onChange={(e) => setYear(e.target.value)} inputMode="numeric" placeholder="年度" aria-label="裁判年度" /><button className="primary-btn" disabled={loading}>{loading ? "搜尋中…" : "搜尋裁判"}</button></form>
    <div className="judicial-search-examples"><span>搜尋範本</span>{SEARCH_EXAMPLES.map((example) => <button type="button" key={example.label} onClick={() => { setQuery(example.query); setCourt(example.court); setYear(example.year); void runSearch(example.query, example.court, example.year); }}><b>{example.label}</b><small>{example.query || `${example.court}／${example.year}年度`}</small></button>)}</div>
    <div className="judicial-search-hint"><span>目前搜尋的是已下載至平台的裁判，下載尚未完成時，結果會持續增加。</span><button type="button" onClick={() => { setQuery(""); setCourt(""); setYear(""); void runSearch("", "", ""); }}>查看最近裁判</button></div>
    {error && <p className="legal-search-error">{error}</p>}{searched && !loading && !error && !results.length && <div className="legal-search-empty">{availableTotal === 0 ? <><b>平台目前尚未下載任何裁判資料</b><span>搜尋功能本身可以使用；請先由管理後台完成司法院裁判同步，資料進來後即可用上方範本搜尋。</span></> : <><b>現有裁判中沒有相符結果</b><span>可縮短關鍵字、只輸入案號，或改用法院與年度篩選。</span></>}</div>}
    <div className="judicial-result-list">{results.map((result) => <article className="judicial-result" key={result.id}><header><span>{result.court || "司法院裁判"}</span><div><h3><Highlight text={result.title} query={query} /></h3><small>{result.year}年度 {result.caseType}字第{result.caseNo}號 · {result.judgmentDate || "日期未載"}</small></div></header><p>{result.excerpt ? <Highlight text={result.excerpt} query={query} /> : "此筆官方下載資料目前僅有案件資訊，尚未附裁判全文。"}</p>{expanded === result.id && result.fullText && <section className="judicial-fulltext"><b>裁判全文</b><p><Highlight text={result.fullText} query={query} /></p></section>}<footer><span>資料來源：司法院裁判資料開放平臺</span><button type="button" disabled={!result.fullText} onClick={() => setExpanded(expanded === result.id ? null : result.id)}>{!result.fullText ? "尚無全文" : expanded === result.id ? "收合全文" : "查看全文"}</button></footer></article>)}</div>
  </section>;
}
