"use client";

import { FormEvent, useEffect, useRef, useState } from "react";

type CaseItem = { jid: string; court: string; judgmentDate: string; title: string; excerpt: string; score: number; matchedQueries: string[]; reasons: string[]; missingConcepts?: string[] };
type Access = { metered: boolean; used: number; limit: number | null; remaining: number | null; temporaryExpiresAt: number | null; pendingRequest?: { id: number } | null };
type Simulation = { notice: string; assessment: string; qualifiedCases: number; totalUniqueCases: number; cloudAvailableTotal: number; rounds: Array<{ round: number; purpose: string; queryRuns: Array<{ query: string; hits: number }>; uniqueCasesSoFar: number }>; results: CaseItem[]; exploratoryCandidates: CaseItem[]; access?: Access };
type CaseDetail = { jid: string; court: string; year: string; caseType: string; caseNo: string; judgmentDate: string; title: string; fullText: string };

const PERSONAS = [
  { key: "litigator", icon: "⚖", name: "訴訟律師", note: "找可引用的裁判見解", questions: ["精神慰撫金是否可以聲請支付命令？", "被害人與有過失時，法院如何酌減精神慰撫金？", "違約金過高時，法院依什麼標準酌減？"] },
  { key: "counsel", icon: "▣", name: "公司法務", note: "評估公司風險與責任", questions: ["員工執行職務侵害他人時，公司僱用人責任如何判斷？", "競業禁止約款沒有補償是否仍然有效？", "董事違反忠實義務時公司可以如何請求損害賠償？"] },
  { key: "assistant", icon: "§", name: "法官助理", note: "整理裁判標準與歧異", questions: ["不作為犯的保證人地位如何判斷？", "行政處分與一般行政措施如何區別？", "正當防衛中的現在不法侵害如何認定？"] },
  { key: "editor", icon: "編", name: "法律編輯", note: "查新舊實務與代表見解", questions: ["近年法院對侵害配偶身分法益的見解是否有變化？", "法院對違約金酌減的最新判斷因素有哪些？", "客觀歸責在交通事故刑事案件中如何運用？"] },
  { key: "student", icon: "學", name: "法律考生", note: "找考試爭點與案例", questions: ["原因自由行為的成立要件是什麼？", "因果歷程錯誤在刑法上如何處理？", "舉證責任倒置與舉證責任減輕有何不同？"] },
  { key: "public", icon: "人", name: "一般民眾", note: "以生活語言尋找方向", questions: ["鄰居漏水一直不處理，我可以要求哪些賠償？", "車禍受傷除了醫療費，可以請求精神賠償嗎？", "對方欠錢不還，我可以直接向法院申請支付命令嗎？"] },
] as const;

const card = { border: "1px solid #d6dce7", borderRadius: 12, padding: 17 } as const;

export default function LegalSearchLabPage() {
  const [question, setQuestion] = useState("精神慰撫金是否可以聲請支付命令？");
  const [persona, setPersona] = useState("");
  const [result, setResult] = useState<Simulation | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [access, setAccess] = useState<Access | null>(null);
  const [showRequest, setShowRequest] = useState(false);
  const [reason, setReason] = useState("");
  const [requestNotice, setRequestNotice] = useState("");
  const counters = useRef<Record<string, number>>({});

  async function loadAccess() { const response = await fetch("/api/legal-search/access", { cache: "no-store" }); if (response.ok) setAccess(await response.json() as Access); }
  useEffect(() => { void loadAccess(); }, []);

  async function runQuestion(value: string) {
    setLoading(true); setError(""); setResult(null);
    try {
      const response = await fetch("/api/admin/judicial-research-test", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ question: value }) });
      const payload = await response.json() as Simulation & { error?: string };
      if (!response.ok) { if (response.status === 429) setShowRequest(true); throw new Error(payload.error || "測試失敗"); }
      setResult(payload); if (payload.access) setAccess(payload.access);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "測試失敗"); }
    finally { setLoading(false); }
  }

  async function choose(item: typeof PERSONAS[number]) {
    const index = counters.current[item.key] ?? 0;
    const next = item.questions[index % item.questions.length];
    counters.current[item.key] = index + 1;
    setPersona(item.name); setQuestion(next);
    await runQuestion(next);
  }

  async function submit(event: FormEvent) { event.preventDefault(); await runQuestion(question); }
  async function requestMore(event: FormEvent) { event.preventDefault(); const response = await fetch("/api/legal-search/access", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ reason, requestedQuota: 100, requestedDays: 3 }) }); const payload = await response.json() as { error?: string }; setRequestNotice(response.ok ? "申請已送出，等待管理者核准。" : payload.error || "申請失敗"); if (response.ok) { setReason(""); setShowRequest(false); await loadAccess(); } }

  return <main style={{ maxWidth: 1120, margin: "0 auto", padding: "28px 20px 80px", color: "#172033" }}>
    <h1 style={{ margin: "18px 0 8px", fontSize: 30 }}>法律搜尋獨立測試室</h1>
    <p style={{ color: "#5d687a", lineHeight: 1.7 }}>選一種使用者，系統就會產生符合該身分的問題並立即搜尋。重複按同一身分，會換下一題。</p>
    {access && <p style={{ background: "#eef4fa", padding: 12, borderRadius: 9 }}>{access.metered ? `本帳號已使用 ${access.used} 次，剩餘 ${access.remaining} 次${access.temporaryExpiresAt ? `；臨時額度至 ${new Date(access.temporaryExpiresAt).toLocaleString("zh-TW")}` : ""}` : "管理者帳號：測試次數不受限制"}{access.pendingRequest ? "；已有申請待審" : ""}</p>}
    <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10, margin: "20px 0" }}>
      {PERSONAS.map((item) => <button type="button" key={item.key} disabled={loading} onClick={() => choose(item)} style={{ textAlign: "left", minHeight: 112, border: persona === item.name ? "2px solid #24558b" : "1px solid #ced6e3", borderRadius: 13, padding: 14, background: persona === item.name ? "#edf5ff" : "white", cursor: loading ? "wait" : "pointer" }}><span style={{ display: "inline-grid", placeItems: "center", width: 32, height: 32, borderRadius: 9, background: "#183b66", color: "white", fontWeight: 700 }}>{item.icon}</span><strong style={{ display: "block", marginTop: 9 }}>{item.name}</strong><small style={{ display: "block", marginTop: 4, color: "#68758a" }}>{item.note}</small></button>)}
    </section>
    <form onSubmit={submit} style={{ background: "#f5f7fb", border: "1px solid #d9dfeb", borderRadius: 14, padding: 20 }}><label htmlFor="legal-question" style={{ display: "block", fontWeight: 700, marginBottom: 8 }}>{persona ? `${persona}的模擬問題` : "自訂法律問題"}</label><textarea id="legal-question" value={question} onChange={(event) => { setQuestion(event.target.value); setPersona(""); }} rows={3} style={{ width: "100%", boxSizing: "border-box", border: "1px solid #aeb9cc", borderRadius: 10, padding: 12, fontSize: 16, lineHeight: 1.6 }} /><button disabled={loading || question.trim().length < 2} style={{ marginTop: 14, border: 0, borderRadius: 9, padding: "11px 18px", background: "#183b66", color: "white", fontSize: 16 }}>{loading ? "正在模擬研究…" : "用這個問題開始測試"}</button></form>
    {error && <p style={{ color: "#a22525", background: "#fff0f0", padding: 14, borderRadius: 10 }}>{error}</p>}
    {access?.metered && (access.remaining === 0 || showRequest) && !access.pendingRequest && <form onSubmit={requestMore} style={{ ...card, marginTop: 14, background: "#fff8ed" }}><strong>申請臨時提高次數</strong><p style={{ color: "#66523b" }}>基本 100 次已用完後可申請；核准額度最長 3 天自動失效。</p><textarea required minLength={4} rows={3} value={reason} onChange={event=>setReason(event.target.value)} placeholder="請說明測試身分、用途與預計測試內容" style={{width:"100%",boxSizing:"border-box",padding:10}}/><button style={{marginTop:10}}>送出申請</button></form>}
    {requestNotice && <p style={{padding:12,background:"#edf8f1",borderRadius:8}}>{requestNotice}</p>}
    {result && <>
      <section style={{ marginTop: 28 }}><h2>查詢過程</h2><p style={{ color: "#756225" }}>{result.notice}</p><p style={{ background: "#eef4fa", borderRadius: 9, padding: 12 }}>目前正式站雲端可搜尋：{result.cloudAvailableTotal.toLocaleString("zh-TW")} 篇裁判。尚在本機拆解、未同步上傳的裁判不包含在內。</p><div style={{ display: "grid", gap: 12 }}>{result.rounds.map((round) => <article key={round.round} style={card}><strong>第 {round.round} 輪：{round.purpose}</strong><div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10 }}>{round.queryRuns.map((run) => <span key={run.query} style={{ background: "#eef3f9", borderRadius: 8, padding: "7px 10px" }}>「{run.query}」找到 {run.hits} 筆</span>)}</div><small style={{ display: "block", marginTop: 10 }}>累計 {round.uniqueCasesSoFar} 篇不重複裁判</small></article>)}</div></section>
      <section style={{ marginTop: 30 }}><h2>搜尋判定</h2><p style={{ background: result.qualifiedCases ? "#edf8f1" : "#fff5e8", border: `1px solid ${result.qualifiedCases ? "#b9dec6" : "#ead0a5"}`, borderRadius: 10, padding: 14, lineHeight: 1.7 }}>{result.assessment}</p></section>
      <CaseList title="建議優先深讀的裁判" items={result.results} empty="目前是 0 篇，代表本次搜尋尚未達到回答需求。" />
      {!!result.exploratoryCandidates.length && <CaseList title="僅供擴大查詢的候選" items={result.exploratoryCandidates} exploratory />}
    </>}
  </main>;
}

function CaseList({ title, items, empty, exploratory = false }: { title: string; items: CaseItem[]; empty?: string; exploratory?: boolean }) {
  const [detail, setDetail] = useState<CaseDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState("");
  const [detailError, setDetailError] = useState("");

  async function openDetail(item: CaseItem) {
    setDetailLoading(item.jid); setDetailError("");
    try {
      const response = await fetch(`/api/judicial-search/${encodeURIComponent(item.jid)}`, { cache: "no-store" });
      const payload = await response.json() as CaseDetail & { error?: string };
      if (!response.ok) throw new Error(payload.error || "裁判全文暫時無法讀取");
      setDetail(payload);
    } catch (caught) {
      setDetailError(caught instanceof Error ? caught.message : "裁判全文暫時無法讀取");
    } finally { setDetailLoading(""); }
  }

  return <section style={{ marginTop: 30 }}><h2>{title}</h2>{!items.length && <p style={{ color: "#7b4d13" }}>{empty}</p>}{detailError && <p style={{ color: "#a22525", background: "#fff0f0", padding: 12, borderRadius: 9 }}>{detailError}</p>}<div style={{ display: "grid", gap: 12 }}>{items.map((item, index) => <article key={item.jid} style={{ ...card, ...(exploratory ? { borderStyle: "dashed", background: "#fffaf2" } : {}) }}><div style={{ color: "#68758a", fontSize: 14 }}>{!exploratory && `第 ${index + 1} 名｜分數 ${item.score}｜`}{item.court}｜{item.judgmentDate}</div><h3 style={{ margin: "7px 0" }}>{item.title}</h3><p style={{ lineHeight: 1.7 }}>{item.excerpt || "本筆尚無可顯示摘要"}</p>{exploratory ? <small>缺少：{item.missingConcepts?.join("、")}｜JID：{item.jid}</small> : <><div style={{ fontSize: 14 }}>命中查法：{item.matchedQueries.join("、")}</div><div style={{ fontSize: 14, marginTop: 4 }}>排序原因：{item.reasons.join("、")}</div><code style={{ display: "block", marginTop: 8, fontSize: 12 }}>{item.jid}</code></>}<button type="button" onClick={() => void openDetail(item)} disabled={detailLoading === item.jid} style={{ marginTop: 14, border: "1px solid #183b66", borderRadius: 8, padding: "9px 14px", background: "white", color: "#183b66", fontWeight: 700, cursor: "pointer" }}>{detailLoading === item.jid ? "讀取全文…" : "查看完整裁判"}</button></article>)}</div>{detail && <CaseReader detail={detail} onClose={() => setDetail(null)} />}</section>;
}

function CaseReader({ detail, onClose }: { detail: CaseDetail; onClose: () => void }) {
  const citation = `${detail.court} ${detail.year}年度${detail.caseType}字第${detail.caseNo}號`;
  return <div role="dialog" aria-modal="true" aria-label="完整裁判" onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(8, 20, 39, .66)", padding: "24px", display: "grid", placeItems: "center" }}>
    <article onClick={event => event.stopPropagation()} style={{ width: "min(920px, 100%)", maxHeight: "calc(100vh - 48px)", overflow: "auto", background: "white", borderRadius: 16, boxShadow: "0 24px 70px rgba(0,0,0,.28)" }}>
      <header style={{ position: "sticky", top: 0, zIndex: 1, background: "#f4f7fb", borderBottom: "1px solid #d8e0eb", padding: "18px 22px", display: "flex", justifyContent: "space-between", gap: 18 }}><div><small style={{ color: "#5f6d82" }}>{detail.court}｜{detail.judgmentDate}</small><h2 style={{ margin: "5px 0 0", fontSize: 22 }}>{detail.title}</h2><div style={{ marginTop: 5, color: "#33445d", fontSize: 14 }}>{citation}</div></div><button type="button" onClick={onClose} aria-label="關閉全文" style={{ alignSelf: "start", border: 0, borderRadius: 8, background: "#183b66", color: "white", padding: "9px 13px", cursor: "pointer" }}>關閉</button></header>
      <div style={{ padding: "22px" }}><div style={{ display: "flex", flexWrap: "wrap", gap: 9, marginBottom: 18 }}><button type="button" onClick={() => void navigator.clipboard?.writeText(citation)} style={{ border: "1px solid #b8c5d6", borderRadius: 8, background: "white", padding: "8px 12px", cursor: "pointer" }}>複製引用格式</button><code style={{ alignSelf: "center", fontSize: 12, color: "#617087" }}>JID：{detail.jid}</code></div>{detail.fullText ? <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.9, fontSize: 16, color: "#202b3c" }}>{detail.fullText.replace(/^\s*file\s+/i, "")}</div> : <p style={{ padding: 18, background: "#fff5e8", borderRadius: 9 }}>這筆官方資料目前沒有附裁判全文。</p>}</div>
    </article>
  </div>;
}
