"use client";

import { FormEvent, useState } from "react";

type Simulation = {
  question: string;
  notice: string;
  assessment: string;
  qualifiedCases: number;
  totalUniqueCases: number;
  rounds: Array<{ round: number; purpose: string; queryRuns: Array<{ query: string; hits: number }>; uniqueCasesSoFar: number }>;
  results: Array<{ jid: string; court: string; judgmentDate: string; title: string; excerpt: string; score: number; matchedQueries: string[]; reasons: string[] }>;
  exploratoryCandidates: Array<{ jid: string; court: string; judgmentDate: string; title: string; excerpt: string; score: number; matchedQueries: string[]; reasons: string[]; missingConcepts: string[] }>;
};

const examples = ["精神慰撫金是否可以聲請支付命令？", "違約金過高時，法院如何酌減？", "不作為犯的保證人地位如何判斷？"];

export default function LegalSearchTestPage() {
  const [question, setQuestion] = useState(examples[0]);
  const [result, setResult] = useState<Simulation | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function run(event: FormEvent) {
    event.preventDefault();
    setLoading(true); setError(""); setResult(null);
    try {
      const response = await fetch("/api/admin/judicial-research-test", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ question }) });
      const payload = await response.json() as Simulation & { error?: string };
      if (!response.ok) throw new Error(payload.error || "測試失敗");
      setResult(payload);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "測試失敗"); }
    finally { setLoading(false); }
  }

  return <main style={{ maxWidth: 1120, margin: "0 auto", padding: "32px 20px 80px", color: "#172033" }}>
    <a href="/admin" style={{ color: "#52627a", textDecoration: "none" }}>← 回總管理處</a>
    <h1 style={{ margin: "18px 0 8px", fontSize: 30 }}>法律搜尋研究模擬器</h1>
    <p style={{ marginTop: 0, color: "#5d687a", lineHeight: 1.7 }}>用完整問題測試系統是否會像研究者一樣換詞、交叉查找與挑選代表性裁判。畫面會保留每輪查詢紀錄，方便判斷搜尋規劃是否正確。</p>
    <form onSubmit={run} style={{ background: "#f5f7fb", border: "1px solid #d9dfeb", borderRadius: 14, padding: 20 }}>
      <label htmlFor="legal-question" style={{ display: "block", fontWeight: 700, marginBottom: 8 }}>要研究的法律問題</label>
      <textarea id="legal-question" value={question} onChange={(event) => setQuestion(event.target.value)} rows={4} style={{ width: "100%", boxSizing: "border-box", border: "1px solid #aeb9cc", borderRadius: 10, padding: 12, fontSize: 16, lineHeight: 1.6, resize: "vertical" }} />
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10 }}>{examples.map((example) => <button type="button" key={example} onClick={() => setQuestion(example)} style={{ border: "1px solid #bdc7d7", borderRadius: 999, padding: "7px 11px", background: "white", cursor: "pointer" }}>{example}</button>)}</div>
      <button disabled={loading || question.trim().length < 2} style={{ marginTop: 16, border: 0, borderRadius: 9, padding: "11px 18px", background: "#183b66", color: "white", fontSize: 16, cursor: "pointer", opacity: loading ? .65 : 1 }}>{loading ? "正在模擬研究…" : "開始模擬查詢"}</button>
    </form>
    {error && <p style={{ color: "#a22525", background: "#fff0f0", padding: 14, borderRadius: 10 }}>{error}</p>}
    {result && <>
      <section style={{ marginTop: 28 }}><h2>查詢過程</h2><p style={{ color: "#756225" }}>{result.notice}</p>
        <div style={{ display: "grid", gap: 12 }}>{result.rounds.map((round) => <article key={round.round} style={{ border: "1px solid #d9dfeb", borderRadius: 12, padding: 16 }}><strong>第 {round.round} 輪：{round.purpose}</strong><div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10 }}>{round.queryRuns.map((run) => <span key={run.query} style={{ background: "#eef3f9", borderRadius: 8, padding: "7px 10px" }}>「{run.query}」找到 {run.hits} 筆</span>)}</div><small style={{ display: "block", marginTop: 10, color: "#68758a" }}>本輪結束累計 {round.uniqueCasesSoFar} 篇不重複裁判</small></article>)}</div>
      </section>
      <section style={{ marginTop: 30 }}><h2>搜尋判定</h2><p style={{ background: result.qualifiedCases ? "#edf8f1" : "#fff5e8", border: `1px solid ${result.qualifiedCases ? "#b9dec6" : "#ead0a5"}`, borderRadius: 10, padding: 14, lineHeight: 1.7 }}>{result.assessment}</p></section>
      <section style={{ marginTop: 30 }}><h2>建議優先深讀的裁判</h2><p>共找到 {result.totalUniqueCases} 篇不重複候選；只有同時涵蓋主要爭點的裁判才會列在這裡。</p>
        {!result.results.length && <p style={{ color: "#7b4d13" }}>目前是 0 篇。這代表本次搜尋尚未達到回答需求，不應拿只提到單一概念的裁判作答。</p>}
        <div style={{ display: "grid", gap: 14 }}>{result.results.map((item, index) => <article key={item.jid} style={{ border: "1px solid #d6dce7", borderRadius: 12, padding: 17 }}><div style={{ color: "#68758a", fontSize: 14 }}>第 {index + 1} 名｜排序分數 {item.score}｜{item.court}｜{item.judgmentDate}</div><h3 style={{ margin: "7px 0" }}>{item.title}</h3><p style={{ lineHeight: 1.7 }}>{item.excerpt || "本筆尚無可顯示摘要"}</p><div style={{ fontSize: 14, color: "#42526b" }}>命中查法：{item.matchedQueries.join("、")}</div><div style={{ fontSize: 14, color: "#42526b", marginTop: 4 }}>排序原因：{item.reasons.join("、")}</div><code style={{ display: "block", marginTop: 8, fontSize: 12, overflowWrap: "anywhere" }}>{item.jid}</code></article>)}</div>
      </section>
      {!!result.exploratoryCandidates.length && <section style={{ marginTop: 30 }}><h2>僅供擴大查詢的候選</h2><p>下列裁判只命中部分概念，不可直接作為答案依據。</p><div style={{ display: "grid", gap: 10 }}>{result.exploratoryCandidates.map((item) => <article key={item.jid} style={{ border: "1px dashed #c6ad88", borderRadius: 10, padding: 14, background: "#fffaf2" }}><strong>{item.court}｜{item.title}</strong><p style={{ margin: "7px 0", lineHeight: 1.6 }}>{item.excerpt || "本筆尚無可顯示摘要"}</p><small>缺少：{item.missingConcepts.join("、")}｜JID：{item.jid}</small></article>)}</div></section>}
    </>}
  </main>;
}
