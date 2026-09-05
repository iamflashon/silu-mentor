"use client";

import { FormEvent, useEffect, useState } from "react";
import { formatTwd, USD_TO_TWD_RATE } from "../../lib/currency";

type CaseItem = { jid: string; court: string; judgmentDate: string; title: string; excerpt: string; score: number; matchedQueries: string[]; reasons: string[]; missingConcepts?: string[]; citationId?: string; citationStatus?: "fulltext-checked" };
type Access = { metered: boolean; used: number; limit: number | null; remaining: number | null; temporaryExpiresAt: number | null; pendingRequest?: { id: number } | null };
type Simulation = { notice: string; assessment: string; qualifiedCases: number; totalUniqueCases: number; cloudAvailableTotal: number; rounds: Array<{ round: number; purpose: string; queryRuns: Array<{ query: string; hits?: number; matched?: number }>; uniqueCasesSoFar: number }>; results: CaseItem[]; exploratoryCandidates: CaseItem[]; improvementReview?: { score: number; status: string; planner: string; queryRuns: number; directEvidence: number; indirectEvidence: number; uniqueCases: number; suggestions: string[] }; improvementComparison?: { previousRunId: number; previousCreatedAt: number; scoreDelta: number; directEvidenceDelta: number; indirectEvidenceDelta: number; uniqueCasesDelta: number; queryRunsDelta: number }; researchBundle?: { allowedCitations: Array<{ citationId: string; jid: string; citation: string }>; notCitableCandidates: Array<{ jid: string; citation: string; reason: string }>; citationRule: string }; access?: Access; researcher?: { planner: "sol" | "rules"; model: string | null; issues?: string[]; terms?: string[]; statutes?: string[]; requiredEvidence?: string[]; exclude?: string[] }; tokenUsage?: { stages: Array<{ stage: string; model: string | null; inputTokens: number; cachedTokens: number; outputTokens: number; totalTokens: number; estimatedCostUsd: number; note: string }>; internalTotalTokens: number; internalEstimatedCostUsd: number; externalAnswerTokens: null; externalAnswerNote: string } };
type CaseDetail = { jid: string; court: string; year: string; caseType: string; caseNo: string; judgmentDate: string; title: string; fullText: string };
type JudicialStatus = {
  searchableCases: number;
  refreshedAt: string;
  node: { online: boolean; lastSeenAt: string; version: string; archives: number; completedArchives: number; totalMembers: number; processed: number; uploaded: number; pendingUpload: number; duplicates: number; failed: number; chunks: number; currentArchive: string; mode: string };
};
type PlanTab = "issues" | "terms" | "statutes" | "evidence" | "exclude";
type QuestionLibrary = { bankSize: number; savedResearchRuns: number; common: Array<{ question: string; askedCount: number }>; history: Array<{ runId: number; question: string; persona: string; source: string; status: string; lastAskedAt: number }> };

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
  const [personaKey, setPersonaKey] = useState("");
  const [shownQuestions, setShownQuestions] = useState<string[]>([]);
  const [questionLoading, setQuestionLoading] = useState(false);
  const [result, setResult] = useState<Simulation | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [access, setAccess] = useState<Access | null>(null);
  const [showRequest, setShowRequest] = useState(false);
  const [reason, setReason] = useState("");
  const [requestNotice, setRequestNotice] = useState("");
  const [judicialStatus, setJudicialStatus] = useState<JudicialStatus | null>(null);
  const [statusError, setStatusError] = useState("");
  const [planTab, setPlanTab] = useState<PlanTab>("issues");
  const [caseResultTab, setCaseResultTab] = useState<"deep" | "expand">("deep");
  const [questionLibrary, setQuestionLibrary] = useState<QuestionLibrary | null>(null);
  const [questionLibraryTab, setQuestionLibraryTab] = useState<"common" | "history">("common");
  const [questionLibraryOpen, setQuestionLibraryOpen] = useState(false);
  const [historyLoading, setHistoryLoading] = useState<number | null>(null);

  async function loadAccess() { const response = await fetch("/api/legal-search/access", { cache: "no-store" }); if (response.ok) setAccess(await response.json() as Access); }
  async function loadQuestionLibrary() { const response = await fetch("/api/legal-search/questions", { cache: "no-store" }); if (response.ok) setQuestionLibrary(await response.json() as QuestionLibrary); }
  async function loadJudicialStatus() {
    try {
      const response = await fetch("/api/judicial-search/status", { cache: "no-store" });
      if (!response.ok) throw new Error("status unavailable");
      setJudicialStatus(await response.json() as JudicialStatus);
      setStatusError("");
    } catch { setStatusError("目前無法讀取匯入進度，稍後會自動重試。"); }
  }
  useEffect(() => {
    void loadAccess();
    void loadQuestionLibrary();
    void loadJudicialStatus();
    const timer = window.setInterval(() => void loadJudicialStatus(), 15_000);
    return () => window.clearInterval(timer);
  }, []);

  async function runQuestion(value: string, personaKey = "", source: "persona" | "custom" = "custom") {
    setLoading(true); setError(""); setResult(null); setCaseResultTab("deep");
    try {
      const response = await fetch("/api/admin/judicial-research-test", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ question: value, persona: personaKey, source }) });
      const payload = await response.json() as Simulation & { error?: string };
      if (!response.ok) { if (response.status === 429) setShowRequest(true); throw new Error(payload.error || "測試失敗"); }
      setResult(payload); if (payload.access) setAccess(payload.access); await loadQuestionLibrary();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "測試失敗"); }
    finally { setLoading(false); }
  }

  async function choose(item: typeof PERSONAS[number]) {
    setQuestionLoading(true); setError("");
    try {
      const response = await fetch("/api/legal-search/questions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ persona: item.key, exclude: shownQuestions }) });
      const payload = await response.json() as { question?: string; error?: string };
      if (!response.ok || !payload.question) throw new Error(payload.error || "暫時無法取得下一題");
      setPersona(item.name); setPersonaKey(item.key); setQuestion(payload.question); setShownQuestions(current => [...current, payload.question!].slice(-12)); setResult(null);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "暫時無法取得下一題"); }
    finally { setQuestionLoading(false); }
  }

  async function changeQuestion() {
    const activePersonaKey = personaKey || "litigator";
    setQuestionLoading(true); setError("");
    try {
      const response = await fetch("/api/legal-search/questions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ persona: activePersonaKey, exclude: shownQuestions }) });
      const payload = await response.json() as { question?: string; error?: string };
      if (!response.ok || !payload.question) throw new Error(payload.error || "暫時無法取得下一題");
      if (!personaKey) { setPersonaKey(activePersonaKey); setPersona(PERSONAS.find(item => item.key === activePersonaKey)?.name || "訴訟律師"); }
      setQuestion(payload.question); setShownQuestions(current => [...current, payload.question!].slice(-12)); setResult(null);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "暫時無法取得下一題"); }
    finally { setQuestionLoading(false); }
  }

  async function submit(event: FormEvent) { event.preventDefault(); await runQuestion(question, personaKey, personaKey ? "persona" : "custom"); }
  async function openHistory(runId: number) {
    setHistoryLoading(runId); setError("");
    try {
      const response = await fetch(`/api/legal-search/questions?run_id=${runId}`, { cache: "no-store" });
      const payload = await response.json() as { question?: string; status?: string; errorMessage?: string; result?: Simulation; error?: string };
      if (!response.ok || !payload.result) throw new Error(payload.error || "研究紀錄讀取失敗");
      if (payload.status === "failed" || !Array.isArray(payload.result.rounds)) throw new Error(payload.errorMessage || "這次研究未完成，已保留失敗紀錄供後續改善。");
      setQuestion(payload.question || ""); setPersona(""); setPersonaKey(""); setResult(payload.result); setCaseResultTab("deep");
      window.setTimeout(() => document.getElementById("legal-research-result")?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "研究紀錄讀取失敗"); }
    finally { setHistoryLoading(null); }
  }
  async function requestMore(event: FormEvent) { event.preventDefault(); const response = await fetch("/api/legal-search/access", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ reason, requestedQuota: 100, requestedDays: 3 }) }); const payload = await response.json() as { error?: string }; setRequestNotice(response.ok ? "申請已送出，等待管理者核准。" : payload.error || "申請失敗"); if (response.ok) { setReason(""); setShowRequest(false); await loadAccess(); } }

  return <main style={{ maxWidth: 1120, margin: "0 auto", padding: "28px 20px 80px", color: "#172033" }}>
    <h1 style={{ margin: "18px 0 8px", fontSize: 30 }}>法律搜尋獨立測試室</h1>
    <p style={{ color: "#5d687a", lineHeight: 1.7 }}>選一種使用者，系統就會產生符合該身分的問題並立即搜尋。重複按同一身分，會換下一題。</p>
    <section style={{ ...card, marginTop: 18, background: "#f7f9fc" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
        <div><h2 style={{ margin: 0, fontSize: 20 }}>裁判資料匯入進度</h2><p style={{ margin: "6px 0 0", color: "#667287" }}>本機完成拆解並上傳後，才會計入 MCP 可搜尋裁判。</p></div>
        <span style={{ padding: "6px 10px", borderRadius: 999, background: judicialStatus?.node.online ? "#e3f5e9" : "#f3e8e8", color: judicialStatus?.node.online ? "#176a38" : "#8a3333", fontWeight: 700 }}>{judicialStatus?.node.online ? "本機節點連線中" : "本機節點未連線"}</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10, marginTop: 16 }}>
        <StatusCard label="MCP可搜尋" value={judicialStatus?.searchableCases} note={judicialStatus?.searchableCases ? "已可立即測試" : "等待首批入庫"} />
        <StatusCard label="RAR進度" value={judicialStatus ? `${judicialStatus.node.completedArchives.toLocaleString()}／${judicialStatus.node.archives.toLocaleString()}` : undefined} note="完成／已下載" />
        <StatusCard label="本機已拆解" value={judicialStatus?.node.processed} note="裁判全文" />
        <StatusCard label="已上傳" value={judicialStatus?.node.uploaded} note="送達正式站" />
        <StatusCard label="待上傳" value={judicialStatus?.node.pendingUpload} note="節點將自動續傳" />
        <StatusCard label="失敗" value={judicialStatus?.node.failed} note="待檢查資料" />
      </div>
      {judicialStatus && <p style={{ margin: "14px 0 0", color: "#5d687a", lineHeight: 1.6 }}>目前檔案：{judicialStatus.node.currentArchive || "等待下一個 RAR"}；模式：{judicialStatus.node.mode === "full" ? "全量拆解" : judicialStatus.node.mode === "test" ? "測試" : "未啟用"}；節點版本：{judicialStatus.node.version || "未回報"}。統計每 15 秒自動更新。</p>}
      {statusError && <p style={{ margin: "12px 0 0", color: "#9a3030" }}>{statusError}</p>}
    </section>
    {access && <p style={{ background: "#eef4fa", padding: 12, borderRadius: 9 }}>{access.metered ? `本帳號已使用 ${access.used} 次，剩餘 ${access.remaining} 次${access.temporaryExpiresAt ? `；臨時額度至 ${new Date(access.temporaryExpiresAt).toLocaleString("zh-TW")}` : ""}` : "管理者帳號：測試次數不受限制"}{access.pendingRequest ? "；已有申請待審" : ""}</p>}
    <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10, margin: "20px 0" }}>
      {PERSONAS.map((item) => <button type="button" key={item.key} disabled={loading || questionLoading} onClick={() => choose(item)} style={{ textAlign: "left", minHeight: 112, border: persona === item.name ? "2px solid #24558b" : "1px solid #ced6e3", borderRadius: 13, padding: 14, background: persona === item.name ? "#edf5ff" : "white", cursor: loading || questionLoading ? "wait" : "pointer" }}><span style={{ display: "inline-grid", placeItems: "center", width: 32, height: 32, borderRadius: 9, background: "#183b66", color: "white", fontWeight: 700 }}>{item.icon}</span><strong style={{ display: "block", marginTop: 9 }}>{item.name}</strong><small style={{ display: "block", marginTop: 4, color: "#68758a" }}>{item.note}</small></button>)}
    </section>
    {questionLibrary && <section style={{ ...card, marginBottom: 18, padding: 0, overflow: "hidden", background: "#fff" }}>
      <div style={{ padding: "18px 20px 14px", background: "linear-gradient(135deg, #f7faff 0%, #eef4fb 100%)", borderBottom: questionLibraryOpen ? "1px solid #d9e2ee" : 0 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 14, alignItems: "flex-start", flexWrap: "wrap" }}>
          <div><h2 style={{ margin: 0, fontSize: 21 }}>法律研究題庫</h2><p style={{ margin: "6px 0 0", color: "#667287" }}>選取問題只會帶入題目，按下開始測試後才會執行研究。</p></div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}><span style={{ padding: "6px 10px", borderRadius: 999, background: "#fff", border: "1px solid #d3deeb", color: "#42536b", fontSize: 14 }}>題庫 {questionLibrary.bankSize} 題</span><span style={{ padding: "6px 10px", borderRadius: 999, background: "#183b66", color: "#fff", fontSize: 14 }}>已保存 {questionLibrary.savedResearchRuns} 次研究</span><button type="button" aria-expanded={questionLibraryOpen} aria-controls="legal-question-library-content" onClick={() => setQuestionLibraryOpen(open => !open)} style={{ border: "1px solid #b9c7d9", borderRadius: 999, padding: "6px 12px", background: "#fff", color: "#183b66", fontWeight: 700, fontSize: 14, cursor: "pointer" }}>{questionLibraryOpen ? "收合題庫 ▲" : "展開題庫 ▼"}</button></div>
        </div>
      </div>
      {questionLibraryOpen && <div id="legal-question-library-content">
      <div role="tablist" aria-label="研究題目分類" style={{ display: "flex", gap: 4, padding: "12px 20px 0", borderBottom: "1px solid #dfe5ee" }}>
        {([['common', `常用問題 ${questionLibrary.common.length}`], ['history', `我的研究紀錄 ${questionLibrary.history.length}`]] as const).map(([key, label]) => <button key={key} type="button" role="tab" aria-selected={questionLibraryTab === key} onClick={() => setQuestionLibraryTab(key)} style={{ border: 0, borderBottom: questionLibraryTab === key ? "3px solid #183b66" : "3px solid transparent", padding: "9px 14px 11px", background: "transparent", color: questionLibraryTab === key ? "#183b66" : "#657287", fontWeight: 700, fontSize: 15, cursor: "pointer" }}>{label}</button>)}
      </div>
      <div style={{ display: "grid", gap: 8, padding: "14px 20px 20px" }}>
        {(questionLibraryTab === "common" ? questionLibrary.common : questionLibrary.history).map((item, index) => { const isHistory = "runId" in item; return <button type="button" key={isHistory ? `history-${item.runId}` : `common-${item.question}`} disabled={loading || (isHistory && historyLoading === item.runId)} onClick={() => isHistory ? void openHistory(item.runId) : (() => { setQuestion(item.question); setPersona(""); setPersonaKey(""); setResult(null); })()} style={{ display: "grid", gridTemplateColumns: "34px minmax(0, 1fr) auto", gap: 12, alignItems: "center", width: "100%", minWidth: 0, border: "1px solid #d8e0eb", borderRadius: 10, padding: "12px 14px", background: "#fff", color: "#243c5a", textAlign: "left", cursor: loading || historyLoading ? "wait" : "pointer" }}><strong style={{ display: "inline-grid", placeItems: "center", width: 30, height: 30, borderRadius: 8, background: "#e8f0fa", color: "#183b66" }}>{index + 1}</strong><span style={{ minWidth: 0, lineHeight: 1.55 }}>{item.question}{isHistory && <small style={{ display: "block", marginTop: 4, color: "#778399" }}>{new Date(item.lastAskedAt).toLocaleString("zh-TW")}</small>}</span><small style={{ padding: "4px 8px", borderRadius: 999, background: isHistory ? "#e9f7ee" : "#f0f3f7", color: isHistory ? "#176a38" : "#667287", whiteSpace: "nowrap" }}>{isHistory ? historyLoading === item.runId ? "讀取中…" : "查看完整紀錄" : `研究 ${item.askedCount} 次`}</small></button> })}
        {questionLibraryTab === "history" && questionLibrary.history.length === 0 && <p style={{ margin: 0, padding: 20, textAlign: "center", color: "#768297" }}>尚無研究紀錄，完成第一次測試後會自動保存在這裡。</p>}
      </div>
      </div>}
    </section>}
    <form onSubmit={submit} style={{ background: "#f5f7fb", border: "1px solid #d9dfeb", borderRadius: 14, padding: 20 }}><div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, marginBottom: 8 }}><label htmlFor="legal-question" style={{ display: "block", fontWeight: 700 }}>{persona ? `${persona}的模擬問題` : "自訂法律問題"}</label><button type="button" disabled={loading || questionLoading} onClick={() => void changeQuestion()} style={{ border: "1px solid #183b66", borderRadius: 8, padding: "7px 13px", background: "white", color: "#183b66", fontWeight: 700, cursor: loading || questionLoading ? "wait" : "pointer" }}>{questionLoading ? "換題中…" : "換一題"}</button></div><textarea id="legal-question" value={question} onChange={(event) => { setQuestion(event.target.value); setPersona(""); setPersonaKey(""); setResult(null); }} rows={3} style={{ width: "100%", boxSizing: "border-box", border: "1px solid #aeb9cc", borderRadius: 10, padding: 12, fontSize: 16, lineHeight: 1.6 }} /><button disabled={loading || questionLoading || question.trim().length < 2} style={{ marginTop: 14, border: 0, borderRadius: 9, padding: "11px 18px", background: "#183b66", color: "white", fontSize: 16 }}>{loading ? "正在模擬研究…" : "用這個問題開始測試"}</button></form>
    {error && <p style={{ color: "#a22525", background: "#fff0f0", padding: 14, borderRadius: 10 }}>{error}</p>}
    {access?.metered && (access.remaining === 0 || showRequest) && !access.pendingRequest && <form onSubmit={requestMore} style={{ ...card, marginTop: 14, background: "#fff8ed" }}><strong>申請臨時提高次數</strong><p style={{ color: "#66523b" }}>基本 100 次已用完後可申請；核准額度最長 3 天自動失效。</p><textarea required minLength={4} rows={3} value={reason} onChange={event=>setReason(event.target.value)} placeholder="請說明測試身分、用途與預計測試內容" style={{width:"100%",boxSizing:"border-box",padding:10}}/><button style={{marginTop:10}}>送出申請</button></form>}
    {requestNotice && <p style={{padding:12,background:"#edf8f1",borderRadius:8}}>{requestNotice}</p>}
    {result && <div id="legal-research-result">
      {result.improvementReview && <section style={{ ...card, marginTop: 28, background: "#f8fafc" }}><div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}><div><h2 style={{ margin: 0 }}>研究品質與改進建議</h2><p style={{ margin: "6px 0 0", color: "#667287" }}>此評估會隨完整研究紀錄保存，用來追蹤 MCP 是否持續改善。</p></div><strong style={{ padding: "8px 12px", borderRadius: 999, background: result.improvementReview.score >= 80 ? "#e3f5e9" : result.improvementReview.score >= 60 ? "#fff4d6" : "#fdeaea", color: result.improvementReview.score >= 80 ? "#176a38" : result.improvementReview.score >= 60 ? "#7b5a08" : "#9a3030" }}>{result.improvementReview.score} 分｜{result.improvementReview.status}</strong></div><div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 8, marginTop: 14 }}>{[["規劃方式", result.improvementReview.planner], ["實際查詢", `${result.improvementReview.queryRuns} 組`], ["直接證據", `${result.improvementReview.directEvidence} 筆`], ["間接候選", `${result.improvementReview.indirectEvidence} 筆`], ["不重複裁判", `${result.improvementReview.uniqueCases} 筆`]].map(([label, value]) => <div key={label} style={{ padding: 10, border: "1px solid #dce3ed", borderRadius: 8, background: "white" }}><small style={{ display: "block", color: "#768297" }}>{label}</small><strong style={{ display: "block", marginTop: 3 }}>{value}</strong></div>)}</div>{result.improvementComparison && <div style={{ marginTop: 14, padding: 12, borderRadius: 9, background: "#edf4fb", color: "#314963", lineHeight: 1.7 }}><strong>與上一次同題研究比較：</strong>品質分數 {result.improvementComparison.scoreDelta >= 0 ? "+" : ""}{result.improvementComparison.scoreDelta}；直接證據 {result.improvementComparison.directEvidenceDelta >= 0 ? "+" : ""}{result.improvementComparison.directEvidenceDelta}；間接候選 {result.improvementComparison.indirectEvidenceDelta >= 0 ? "+" : ""}{result.improvementComparison.indirectEvidenceDelta}；不重複裁判 {result.improvementComparison.uniqueCasesDelta >= 0 ? "+" : ""}{result.improvementComparison.uniqueCasesDelta}。</div>}<h3 style={{ margin: "16px 0 8px", fontSize: 16 }}>下一步需要調整</h3><ol style={{ margin: 0, paddingLeft: 24, lineHeight: 1.75 }}>{result.improvementReview.suggestions.map(item => <li key={item}>{item}</li>)}</ol></section>}
      {result.researcher && <section style={{ marginTop: 28 }}><h2>Sol 如何拆解這個問題</h2><p style={{ color: "#59677b" }}>Sol 只制定研究策略，不生成法律答案。以下內容會實際影響資料庫查詢與證據篩選。</p><PlanTabs researcher={result.researcher} active={planTab} onChange={setPlanTab} /></section>}
      <section style={{ marginTop: 28 }}><h2>實際搜尋過程</h2><p style={{ color: "#756225" }}>{result.notice}</p><p style={{ background: "#eef4fa", borderRadius: 9, padding: 12 }}>目前正式站雲端可搜尋：{result.cloudAvailableTotal.toLocaleString("zh-TW")} 篇裁判。尚在本機拆解、未同步上傳的裁判不包含在內。</p><div style={{ display: "grid", gap: 12 }}>{result.rounds.map((round) => <article key={round.round} style={card}><strong>第 {round.round} 輪：{round.purpose}</strong><div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10 }}>{round.queryRuns.map((run) => <span key={run.query} style={{ background: "#eef3f9", borderRadius: 8, padding: "7px 10px" }}>「{run.query}」找到 {(run.matched ?? run.hits ?? 0).toLocaleString("zh-TW")} 筆</span>)}</div><small style={{ display: "block", marginTop: 10 }}>累計 {round.uniqueCasesSoFar} 篇不重複裁判</small></article>)}</div></section>
      <section style={{ marginTop: 30 }}><h2>搜尋判定</h2><p style={{ background: result.qualifiedCases ? "#edf8f1" : "#fff5e8", border: `1px solid ${result.qualifiedCases ? "#b9dec6" : "#ead0a5"}`, borderRadius: 10, padding: 14, lineHeight: 1.7 }}>{result.assessment}</p></section>
      {result.researchBundle && <section style={{ ...card, marginTop: 24, background: "#f7fafc" }}><h2 style={{ marginTop: 0 }}>本次研究證據包</h2><p style={{ lineHeight: 1.7 }}>{result.researchBundle.citationRule}</p><div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))", gap: 12 }}><article style={{ padding: 14, borderRadius: 10, background: "#e9f7ee" }}><strong style={{ color: "#176a38" }}>可引用 {result.researchBundle.allowedCitations.length} 筆</strong><p style={{ marginBottom: 0, color: "#456253" }}>已由系統讀取全文並通過本題的關聯與假命中檢查。</p></article><article style={{ padding: 14, borderRadius: 10, background: "#fff4e5" }}><strong style={{ color: "#8a5516" }}>不可直接引用 {result.researchBundle.notCitableCandidates.length} 筆</strong><p style={{ marginBottom: 0, color: "#6f5a3b" }}>只作為後續搜尋線索，不能支持肯定或否定結論。</p></article></div></section>}
      {result.tokenUsage && <section style={{ marginTop: 30 }}><h2>本次 MCP Token 與成本</h2><div style={{ overflowX: "auto" }}><table style={{ width: "100%", borderCollapse: "collapse", background: "white", minWidth: 820 }}><thead><tr>{["處理階段", "模型", "輸入", "快取", "輸出", "合計", "美元估算", "台幣估算"].map(label => <th key={label} style={{ textAlign: "left", padding: 10, borderBottom: "2px solid #cbd5e3" }}>{label}</th>)}</tr></thead><tbody>{result.tokenUsage.stages.map(stage => <tr key={stage.stage}><td style={{ padding: 10, borderBottom: "1px solid #e2e7ef" }}>{stage.stage}<small style={{ display: "block", color: "#6c788b" }}>{stage.note}</small></td><td style={{ padding: 10, borderBottom: "1px solid #e2e7ef" }}>{stage.model || "—"}</td><td style={{ padding: 10, borderBottom: "1px solid #e2e7ef" }}>{stage.inputTokens.toLocaleString()}</td><td style={{ padding: 10, borderBottom: "1px solid #e2e7ef" }}>{stage.cachedTokens.toLocaleString()}</td><td style={{ padding: 10, borderBottom: "1px solid #e2e7ef" }}>{stage.outputTokens.toLocaleString()}</td><td style={{ padding: 10, borderBottom: "1px solid #e2e7ef", fontWeight: 700 }}>{stage.totalTokens.toLocaleString()}</td><td style={{ padding: 10, borderBottom: "1px solid #e2e7ef" }}>US$ {stage.estimatedCostUsd.toFixed(5)}</td><td style={{ padding: 10, borderBottom: "1px solid #e2e7ef", fontWeight: 700 }}>約 NT$ {formatTwd(stage.estimatedCostUsd, 2)}</td></tr>)}</tbody></table></div><p style={{ background: "#eef4fa", borderRadius: 9, padding: 12, lineHeight: 1.7 }}><strong>MCP 內部合計：{result.tokenUsage.internalTotalTokens.toLocaleString()} Tokens；US$ {result.tokenUsage.internalEstimatedCostUsd.toFixed(5)}；約 NT$ {formatTwd(result.tokenUsage.internalEstimatedCostUsd, 2)}。</strong><br /><small>估算基準：gpt-5.6-sol 輸入 US$5／百萬 Token、快取 US$0.5／百萬 Token、輸出 US$30／百萬 Token；換算匯率 US$1＝NT$ {USD_TO_TWD_RATE}。實際帳單可能因供應商計價與匯率不同而略有差異。</small><br />{result.tokenUsage.externalAnswerNote}</p></section>}
      <section style={{ marginTop: 30 }}>
        <div role="tablist" aria-label="裁判搜尋結果分類" style={{ display: "flex", gap: 6, borderBottom: "1px solid #cfd9e6", overflowX: "auto" }}>
          <button type="button" role="tab" aria-selected={caseResultTab === "deep"} onClick={() => setCaseResultTab("deep")} style={{ flex: "0 0 auto", border: 0, borderBottom: caseResultTab === "deep" ? "3px solid #183b66" : "3px solid transparent", padding: "11px 16px", background: caseResultTab === "deep" ? "#edf4fb" : "transparent", color: caseResultTab === "deep" ? "#183b66" : "#657287", fontWeight: 700, fontSize: 16, cursor: "pointer" }}>優先深讀 <small style={{ marginLeft: 5 }}>{result.results.length}</small></button>
          <button type="button" role="tab" aria-selected={caseResultTab === "expand"} onClick={() => setCaseResultTab("expand")} style={{ flex: "0 0 auto", border: 0, borderBottom: caseResultTab === "expand" ? "3px solid #9a641d" : "3px solid transparent", padding: "11px 16px", background: caseResultTab === "expand" ? "#fff7e8" : "transparent", color: caseResultTab === "expand" ? "#815317" : "#657287", fontWeight: 700, fontSize: 16, cursor: "pointer" }}>擴大查詢 <small style={{ marginLeft: 5 }}>{result.exploratoryCandidates.length}</small></button>
        </div>
        {caseResultTab === "deep" ? <CaseList title="建議優先深讀的裁判" items={result.results} empty="目前是 0 篇，代表本次搜尋尚未達到回答需求。" /> : <CaseList title="僅供擴大查詢的候選" items={result.exploratoryCandidates} empty="目前沒有需要擴大查詢的候選裁判。" exploratory />}
      </section>
    </div>}
  </main>;
}

function StatusCard({ label, value, note }: { label: string; value: number | string | undefined; note: string }) {
  const display = typeof value === "number" ? value.toLocaleString("zh-TW") : value ?? "—";
  return <article style={{ background: "white", border: "1px solid #dbe2ed", borderRadius: 10, padding: 13 }}><span style={{ display: "block", color: "#68758a", fontSize: 13 }}>{label}</span><strong style={{ display: "block", marginTop: 5, fontSize: 23, color: "#183b66" }}>{display}</strong><small style={{ color: "#758196" }}>{note}</small></article>;
}

function PlanCard({ title, items, empty = "未提出" }: { title: string; items?: string[]; empty?: string }) {
  return <article role="tabpanel" style={{ ...card, minHeight: 180, background: "#fbfcfe" }}><strong style={{ color: "#183b66", fontSize: 18 }}>{title}</strong>{items?.length ? <div style={{ display: "grid", gridTemplateColumns: items.length > 5 ? "repeat(auto-fit, minmax(min(360px, 100%), 1fr))" : "1fr", gap: "9px 36px", marginTop: 14 }}>{items.map((item, index) => <div key={item} style={{ display: "grid", gridTemplateColumns: "30px minmax(0, 1fr)", alignItems: "start", gap: 9, lineHeight: 1.75 }}><span aria-hidden="true" style={{ display: "inline-grid", placeItems: "center", width: 28, height: 28, marginTop: 1, borderRadius: 999, background: "#183b66", color: "white", fontWeight: 800, fontSize: 14 }}>{index + 1}</span><span>{item}</span></div>)}</div> : <p style={{ margin: "14px 0 0", color: "#7a8698" }}>{empty}</p>}</article>;
}

function PlanTabs({ researcher, active, onChange }: { researcher: NonNullable<Simulation["researcher"]>; active: PlanTab; onChange: (tab: PlanTab) => void }) {
  const tabs: Array<{ key: PlanTab; label: string; title: string; items?: string[]; empty?: string }> = [
    { key: "issues", label: "法律爭點", title: "法律爭點", items: researcher.issues, empty: researcher.planner === "rules" ? "Sol 暫時不可用，本次採保守規則拆解" : "未提出" },
    { key: "terms", label: "搜尋用語", title: "同義詞與裁判常用語", items: researcher.terms },
    { key: "statutes", label: "可能法條", title: "可能適用法條", items: researcher.statutes },
    { key: "evidence", label: "必要證據", title: "全文必須找到的證據", items: researcher.requiredEvidence },
    { key: "exclude", label: "排除條件", title: "必須排除的假命中", items: researcher.exclude },
  ];
  const selected = tabs.find((tab) => tab.key === active) ?? tabs[0];
  return <div><nav role="tablist" aria-label="Sol 研究策略分類" style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 8 }}>{tabs.map((tab) => <button key={tab.key} type="button" role="tab" aria-selected={active === tab.key} onClick={() => onChange(tab.key)} style={{ flex: "0 0 auto", border: active === tab.key ? "1px solid #183b66" : "1px solid #cbd5e3", borderRadius: "9px 9px 0 0", padding: "10px 15px", background: active === tab.key ? "#183b66" : "#f5f7fa", color: active === tab.key ? "white" : "#33445d", fontWeight: 700, cursor: "pointer" }}>{tab.label} <small style={{ marginLeft: 4, opacity: .8 }}>{tab.items?.length ?? 0}</small></button>)}</nav><PlanCard title={selected.title} items={selected.items} empty={selected.empty} /></div>;
}

function HighlightText({ text, queries }: { text: string; queries: string[] }) {
  const terms = [...new Set(queries.flatMap(query => query.split(/\s+|AND|OR|[、，,＋+]/i)).map(term => term.replace(/[「」"'()]/g, "").trim()).filter(term => term.length >= 2))].sort((a, b) => b.length - a.length).slice(0, 12);
  if (!terms.length) return <>{text}</>;
  const escaped = terms.map(term => term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const pattern = new RegExp(`(${escaped.join("|")})`, "gi");
  return <>{text.split(pattern).map((part, index) => terms.some(term => term.toLocaleLowerCase("zh-TW") === part.toLocaleLowerCase("zh-TW")) ? <mark key={`${part}-${index}`} style={{ background: "#fff09b", color: "#6b4200", padding: "0 2px" }}>{part}</mark> : part)}</>;
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

  return <section style={{ marginTop: 30 }}><div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}><h2 style={{ marginBottom: 10 }}>{title}</h2>{items.length > 0 && <small style={{ color: "#69768a" }}>共 {items.length} 筆</small>}</div>{!items.length && <p style={{ color: "#7b4d13" }}>{empty}</p>}{detailError && <p style={{ color: "#a22525", background: "#fff0f0", padding: 12, borderRadius: 9 }}>{detailError}</p>}<div style={{ border: "1px solid #ccd7e4", borderRadius: 12, overflow: "hidden", background: "white" }}>{items.map((item, index) => <article key={item.jid} style={{ display: "grid", gridTemplateColumns: "44px minmax(0, 1fr)", gap: 12, padding: "16px 18px", borderBottom: index < items.length - 1 ? "1px solid #dce3ec" : 0, background: exploratory ? "#fffaf2" : index % 2 ? "#fbfcfe" : "white" }}><strong style={{ display: "inline-grid", placeItems: "center", alignSelf: "start", width: 32, height: 32, borderRadius: 8, background: exploratory ? "#f5e7ca" : "#e8f0fa", color: "#183b66" }}>{index + 1}</strong><div style={{ minWidth: 0 }}><div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto auto", gap: 12, alignItems: "start" }}><button type="button" onClick={() => void openDetail(item)} disabled={detailLoading === item.jid} style={{ border: 0, padding: 0, background: "transparent", color: "#164f95", textAlign: "left", fontWeight: 700, fontSize: 16, lineHeight: 1.5, cursor: "pointer" }}>{item.court}　{item.title}</button><span style={{ color: "#59677a", fontSize: 14, whiteSpace: "nowrap" }}>{item.judgmentDate}</span>{item.citationId ? <strong style={{ color: "#176a38", background: "#e9f7ee", borderRadius: 999, padding: "3px 8px", fontSize: 12, whiteSpace: "nowrap" }}>全文已檢查</strong> : <span />}</div><p style={{ margin: "11px 0", lineHeight: 1.75, color: "#303b4b" }}><HighlightText text={item.excerpt || "本筆尚無可顯示摘要"} queries={item.matchedQueries} /></p>{exploratory ? <small style={{ display: "block", lineHeight: 1.65, overflowWrap: "anywhere", color: "#765a2b" }}>缺少：{item.missingConcepts?.join("、")}｜JID：{item.jid}</small> : <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}><small style={{ color: "#68758a", overflowWrap: "anywhere" }}>分數 {item.score}｜命中：{item.matchedQueries.join("、")}｜JID：{item.jid}</small><button type="button" onClick={() => void openDetail(item)} disabled={detailLoading === item.jid} style={{ border: "1px solid #183b66", borderRadius: 7, padding: "7px 11px", background: "white", color: "#183b66", fontWeight: 700, cursor: "pointer" }}>{detailLoading === item.jid ? "讀取中…" : "閱讀全文"}</button></div>}</div></article>)}</div>{detail && <CaseReader detail={detail} onClose={() => setDetail(null)} />}</section>;
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
