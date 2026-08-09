"use client";

import { useEffect, useMemo, useState } from "react";
import { formatTwd } from "../../lib/currency";

type Question = { id: number; year: string; examName: string; subject: string; questionNumber: string; stem: string; answerSource: string };
type SampleLevel = "basic" | "intermediate" | "advanced";
type Result = { analysis: string; model: string; modelId: string; reason: string; answerSource: string; sampleLabel?: string | null; usage: { inputTokens: number; outputTokens: number; cachedTokens: number; estimatedCostUsd: number; durationMs: number } };
type WorkflowResult = { analysis: string; model: string; usage: Result["usage"] };
type Workflow = { solReview?: WorkflowResult; challenger?: "terra" | "sonnet"; challenge?: WorkflowResult; lunaReply?: WorkflowResult; solReply?: WorkflowResult };
type SavedRecord = { studentIssues: string; studentSupplement: string; sampleLevel?: SampleLevel | null; lunaResult: Result | null; solResult: Result | null; challengeWorkflow?: Workflow; updatedAt: string };

function cleanAnalysisLine(line: string) {
  return line.replace(/^\s{0,3}#{1,6}\s*/u, "").replace(/^\s*```(?:\w+)?\s*$/u, "").replace(/\*\*([^*]+)\*\*/gu, "$1").replace(/__([^_]+)__/gu, "$1").replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/gu, "$1").replace(/(?<!_)_([^_\n]+)_(?!_)/gu, "$1").replace(/`([^`]+)`/gu, "$1").replace(/\*\*/gu, "").trim();
}

export function IssuePractice() {
  const [questions, setQuestions] = useState<Question[]>([]);
  const [questionId, setQuestionId] = useState(0);
  const [subject, setSubject] = useState("全部");
  const [year, setYear] = useState("全部");
  const [studentIssues, setStudentIssues] = useState("");
  const [studentSupplement, setStudentSupplement] = useState("");
  const [sampleLevel, setSampleLevel] = useState<SampleLevel | null>(null);
  const [results, setResults] = useState<Partial<Record<"luna" | "sol", Result>>>({});
  const [activeResult, setActiveResult] = useState<"luna" | "sol">("luna");
  const [workflow, setWorkflow] = useState<Workflow>({});
  const [workflowLoading, setWorkflowLoading] = useState<"review" | "terra" | "sonnet" | "luna" | "sol" | null>(null);
  const [challengeText, setChallengeText] = useState("");
  const [historyIds, setHistoryIds] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState<"luna" | "sol" | null>(null);
  const [recordLoading, setRecordLoading] = useState(false);
  const [savingSupplement, setSavingSupplement] = useState(false);
  const [savedNotice, setSavedNotice] = useState("");
  const [sampleLoading, setSampleLoading] = useState<SampleLevel | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    void fetch("/api/issue-practice").then(async (response) => {
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "讀取失敗");
      setQuestions(data.questions || []);
      setHistoryIds(new Set((data.history || []).map((item: { questionId: number }) => item.questionId)));
    }).catch((reason) => setError(reason instanceof Error ? reason.message : "題庫讀取失敗"));
  }, []);

  const subjects = useMemo(() => ["全部", ...new Set(questions.map((item) => item.subject).filter(Boolean))], [questions]);
  const years = useMemo(() => ["全部", ...new Set(questions.map((item) => item.year).filter(Boolean))], [questions]);
  const filtered = questions.filter((item) => (subject === "全部" || item.subject === subject) && (year === "全部" || item.year === year));
  const selected = questions.find((item) => item.id === questionId) ?? null;
  const result = results[activeResult] ?? results.luna ?? results.sol ?? null;

  async function submit(model: "luna" | "sol") {
    if (!selected || studentIssues.trim().length < 10 || loading) return;
    setLoading(model); setError("");
    const response = await fetch("/api/issue-practice", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ questionId: selected.id, studentIssues, model, sampleLevel }) });
    const data = await response.json(); setLoading(null);
    if (!response.ok) return setError(data.error || "AI 比對失敗");
    setResults((current) => ({ ...current, [model]: data as Result })); setActiveResult(model);
    setHistoryIds((current) => new Set(current).add(selected.id)); setSavedNotice("本題練習與回答已保存");
  }

  async function loadSample(level: SampleLevel) {
    if (!selected || sampleLoading) return;
    setSampleLoading(level); setError(""); setResults({});
    const response = await fetch("/api/issue-practice", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "sample", questionId: selected.id, sampleLevel: level }) });
    const data = await response.json(); setSampleLoading(null);
    if (!response.ok) return setError(data.error || "測試擬答讀取失敗");
    setStudentIssues(String(data.text || "")); setSampleLevel(level); setStudentSupplement(""); setSavedNotice("");
  }

  async function choose(value: number) {
    setQuestionId(value); setStudentIssues(""); setStudentSupplement(""); setSampleLevel(null); setResults({}); setWorkflow({}); setChallengeText(""); setActiveResult("luna"); setSavedNotice(""); setError("");
    if (!value) return;
    setRecordLoading(true);
    try {
      const response = await fetch(`/api/issue-practice?questionId=${value}`); const data = await response.json();
      if (!response.ok) throw new Error(data.error || "紀錄讀取失敗");
      const record = data.record as SavedRecord | null;
      if (record) {
        setStudentIssues(record.studentIssues || ""); setStudentSupplement(record.studentSupplement || ""); setSampleLevel(record.sampleLevel ?? null);
        setResults({ ...(record.lunaResult ? { luna: record.lunaResult } : {}), ...(record.solResult ? { sol: record.solResult } : {}) });
        setWorkflow(record.challengeWorkflow || {}); setChallengeText(record.challengeWorkflow?.challenge?.analysis || "");
        setActiveResult(record.solResult ? "sol" : "luna"); setSavedNotice("已載入上次練習紀錄");
      }
    } catch (reason) { setError(reason instanceof Error ? reason.message : "紀錄讀取失敗"); }
    finally { setRecordLoading(false); }
  }

  async function runWorkflow(action: "sol-review-luna" | "challenge" | "reply", option?: "terra" | "sonnet" | "luna" | "sol") {
    if (!selected || workflowLoading) return;
    const key = action === "sol-review-luna" ? "review" : option || "terra"; setWorkflowLoading(key as typeof workflowLoading); setError("");
    const response = await fetch("/api/issue-practice", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, questionId: selected.id, studentIssues, challenger: action === "challenge" ? option : undefined, model: action === "reply" ? option : undefined, challengeText }) });
    const data = await response.json(); setWorkflowLoading(null);
    if (!response.ok) return setError(data.error || "本次檢核暫時無法完成");
    setWorkflow(data.workflow || {}); if (action === "challenge") setChallengeText(data.result?.analysis || ""); setSavedNotice("本題質疑與答辯歷程已保存");
  }

  function renderWorkflowResult(item?: WorkflowResult) { if (!item) return null; return <div className="issue-workflow-result"><div className="student-issue-analysis">{item.analysis.split("\n").map((line, index) => { const cleanLine = cleanAnalysisLine(line); return cleanLine ? <p className={/^[一二三四五六七八九十]、/.test(cleanLine) ? "heading" : ""} key={index}>{cleanLine}</p> : <br key={index} />; })}</div><small>{item.model} · {(item.usage.inputTokens + item.usage.outputTokens).toLocaleString()} tokens · NT$ {formatTwd(item.usage.estimatedCostUsd)}</small></div>; }

  async function saveSupplement() {
    if (!selected || savingSupplement) return;
    setSavingSupplement(true); setError("");
    const response = await fetch("/api/issue-practice", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "save-supplement", questionId: selected.id, studentIssues, studentSupplement, sampleLevel }) });
    const data = await response.json(); setSavingSupplement(false);
    if (!response.ok) return setError(data.error || "補充看法保存失敗");
    setHistoryIds((current) => new Set(current).add(selected.id)); setSavedNotice("補充看法已保存");
  }

  return <section className="student-issue-practice" aria-label="練爭點">
    <header className="student-issue-hero"><div><span>ISSUE SPOTTING PRACTICE</span><h2>練爭點</h2><p>先自己找，再讓 AI 依同題老師擬答逐項比對。重點不是背答案，而是看見自己漏在哪一層。</p></div><aside><b>{questions.length}</b><span>題已核對擬答</span><small>只顯示可可靠比對的題目</small></aside></header>
    <div className="student-issue-steps"><span className={selected ? "done" : "active"}><b>1</b> 選真題</span><span className={selected && !result ? "active" : result ? "done" : ""}><b>2</b> 寫爭點</span><span className={result ? "active" : ""}><b>3</b> 看比對</span></div>
    <section className="student-issue-picker"><div><label>科目<select value={subject} onChange={(event) => { setSubject(event.target.value); void choose(0); }}>{subjects.map((item) => <option key={item}>{item}</option>)}</select></label><label>年度<select value={year} onChange={(event) => { setYear(event.target.value); void choose(0); }}>{years.map((item) => <option key={item}>{item}</option>)}</select></label></div><label>歷屆題目<select value={questionId} onChange={(event) => void choose(Number(event.target.value))}><option value={0}>{questions.length ? "請選擇一題" : "正在讀取題庫…"}</option>{filtered.map((item) => <option key={item.id} value={item.id}>{historyIds.has(item.id) ? "✓ 已練｜" : ""}{item.year}｜{item.subject}｜{item.examName || "司律二試"}第 {item.questionNumber} 題</option>)}</select></label>{recordLoading && <small className="issue-record-status">正在載入這題的練習紀錄…</small>}</section>
    {selected ? <><article className="student-issue-question"><header><div><span>{selected.subject}</span><b>{selected.year}｜{selected.examName || "司律二試"}第 {selected.questionNumber} 題</b></div><small>本題已連結：{selected.answerSource || "老師參考擬答"}</small></header><p>{selected.stem}</p></article><section className="student-issue-answer"><header><div><span>YOUR ISSUE LIST</span><h3>你認為本題有哪些爭點？</h3></div><small>可依「行為人 → 行為 → 罪名／法律問題」逐行列出</small></header><div className="issue-sample-tools"><div><b>助教辨識力測試</b><span>帶入三種程度的測試擬答，檢查 Luna 是否正確判級與指出缺漏。</span></div><div>{([["basic","基礎擬答","明顯缺漏"],["intermediate","中等擬答","大致命中"],["advanced","高分擬答","完整有層次"]] as const).map(([level,label,note]) => <button type="button" className={sampleLevel === level ? "active" : ""} disabled={Boolean(sampleLoading)} onClick={() => void loadSample(level)} key={level}><b>{sampleLoading === level ? "載入中…" : label}</b><small>{note}</small></button>)}</div></div><textarea rows={10} value={studentIssues} onChange={(event) => { setStudentIssues(event.target.value); setSavedNotice(""); if (sampleLevel) setSampleLevel(null); }} placeholder={'例如：\n一、甲……是否成立……罪？\n二、乙……涉及何種總則爭點？\n三、甲、乙間是否成立共同正犯？'} /><footer><span>{studentIssues.trim().length} 字{sampleLevel ? ` · 測試樣本：${sampleLevel === "basic" ? "基礎" : sampleLevel === "intermediate" ? "中等" : "高分"}` : ""}</span><button type="button" onClick={() => void submit("luna")} disabled={Boolean(loading) || studentIssues.trim().length < 10}>{loading ? "AI 正在逐項比對…" : results.luna ? "重新請 Luna 助教比對" : "送出給 Luna 助教比對"}</button></footer></section></> : <div className="student-issue-empty"><b>先選一題開始</b><span>題目不會立即顯示答案；請先完成自己的爭點清單。</span></div>}
    {error && <p className="student-issue-error">{error}</p>}
    {result && <section className="student-issue-result"><header><div><span>AI COMPARISON</span><h3>AI 逐項分析</h3></div><b>{savedNotice || "已完成並保存"}</b></header><div className="issue-result-tabs" role="tablist" aria-label="切換 Luna 與 Sol 回答"><button type="button" role="tab" aria-selected={activeResult === "luna"} className={activeResult === "luna" ? "active" : ""} disabled={!results.luna} onClick={() => setActiveResult("luna")}>Luna 評論同學{results.luna ? "｜已完成" : "｜尚未回答"}</button><button type="button" role="tab" aria-selected={activeResult === "sol"} className={activeResult === "sol" ? "active" : ""} disabled={!results.sol} onClick={() => setActiveResult("sol")}>Sol 評論同學{results.sol ? "｜已完成" : "｜尚未回答"}</button></div>{result.sampleLabel && <div className="issue-sample-verdict"><span>測試預期</span><b>{result.sampleLabel}</b><small>請核對下方「程度判定」是否一致；不一致代表助教分級仍需調整。</small></div>}<div className="student-issue-analysis">{result.analysis.split("\n").map((line, index) => { const cleanLine = cleanAnalysisLine(line); return cleanLine ? <p className={/^[一二三四五六]、/.test(cleanLine) ? "heading" : ""} key={index}>{cleanLine}</p> : <br key={index} />; })}</div><footer><div><b>此次對話使用 {result.model}</b><span>原因：{result.reason}</span><small>{result.modelId} · {(result.usage.inputTokens + result.usage.outputTokens).toLocaleString()} tokens · {result.usage.cachedTokens.toLocaleString()} cached · {(result.usage.durationMs / 1000).toFixed(1)} 秒 · 約 US$ {result.usage.estimatedCostUsd.toFixed(5)}／NT$ {formatTwd(result.usage.estimatedCostUsd)}</small></div>{!results.sol && <button type="button" onClick={() => void submit("sol")} disabled={Boolean(loading)}>{loading === "sol" ? "Sol 分析中…" : "請 Sol 評論同學"}</button>}{!results.luna && <button type="button" onClick={() => void submit("luna")} disabled={Boolean(loading)}>{loading === "luna" ? "Luna 分析中…" : "請 Luna 助教分析"}</button>}</footer>{results.luna && results.sol && <section className="issue-challenge-flow"><header><span>MODEL CHALLENGE</span><h4>覆核、質疑與答辯</h4><p>兩份評論完成後，才進入這一區；所有模型都會重新讀取完整老師擬答。</p></header><div className="issue-flow-step"><b>1　Sol 獨立覆核 Luna</b><button type="button" onClick={() => void runWorkflow("sol-review-luna")} disabled={Boolean(workflowLoading)}>{workflowLoading === "review" ? "覆核中…" : workflow.solReview ? "重新覆核 Luna" : "請 Sol 覆核 Luna"}</button>{renderWorkflowResult(workflow.solReview)}</div><div className="issue-flow-step"><b>2　選擇擬答質疑者</b><p>只針對模型回答與老師擬答的實質差異提出質疑；沒有錯誤時不得硬問。</p><div className="issue-challenger-buttons"><button type="button" onClick={() => void runWorkflow("challenge", "terra")} disabled={Boolean(workflowLoading)}>{workflowLoading === "terra" ? "Terra 檢核中…" : "Terra 質疑者｜理性檢核"}</button><button type="button" onClick={() => void runWorkflow("challenge", "sonnet")} disabled={Boolean(workflowLoading)}>{workflowLoading === "sonnet" ? "Sonnet 檢核中…" : "Sonnet 質疑者｜教學式追問"}</button></div>{workflow.challenge && <><textarea rows={8} value={challengeText} onChange={(event) => setChallengeText(event.target.value)} aria-label="可修改的質疑內容" />{renderWorkflowResult({ ...workflow.challenge, analysis: challengeText })}</>}</div>{workflow.challenge && <div className="issue-flow-step"><b>3　指定誰回應質疑並提出修正版</b><div className="issue-challenger-buttons"><button type="button" onClick={() => void runWorkflow("reply", "luna")} disabled={Boolean(workflowLoading) || challengeText.trim().length < 10}>{workflowLoading === "luna" ? "Luna 回應中…" : "請 Luna 回應並修正"}</button><button type="button" onClick={() => void runWorkflow("reply", "sol")} disabled={Boolean(workflowLoading) || challengeText.trim().length < 10}>{workflowLoading === "sol" ? "Sol 回應中…" : "請 Sol 回應並修正"}</button></div>{workflow.lunaReply && <details open><summary>Luna 的答辯與修正版</summary>{renderWorkflowResult(workflow.lunaReply)}</details>}{workflow.solReply && <details open><summary>Sol 的答辯與修正版</summary>{renderWorkflowResult(workflow.solReply)}</details>}</div>}</section>}<section className="issue-student-supplement"><header><div><span>MY FOLLOW-UP</span><h4>補充我的看法</h4></div><small>可記下不同見解、漏掉的爭點或看完兩份回答後的修正。</small></header><textarea rows={5} value={studentSupplement} onChange={(event) => { setStudentSupplement(event.target.value); setSavedNotice(""); }} placeholder="例如：我認為此處仍應區分……；老師擬答採……，但若採另一說……" /><footer><span>{studentSupplement.trim().length} 字</span><button type="button" onClick={() => void saveSupplement()} disabled={savingSupplement}>{savingSupplement ? "保存中…" : "保存補充看法"}</button></footer></section></section>}
  </section>;
}
