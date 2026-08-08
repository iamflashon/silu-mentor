"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

type Verdict = { score: number; fatal: string[]; judgeCostUsd: number };
type ResponseRow = { id: number; label: string; model: string; text: string; inputTokens: number; outputTokens: number; durationMs: number; estimatedCostUsdMicros: number; verdict: Verdict | null };
type Question = { id: number; group: string; round: number; subject: string; title: string; prompt: string; rule: string; expected: string; forbidden: string[]; fatal: string[]; responses: ResponseRow[] };
type Run = { id: string; label: string; startedAt: string; completed: number; answered?: number; total: number };
type Data = { target: number; judge: string; runId: string | null; runs: Run[]; questions: Question[] };

const DEEPSEEK_LABEL = "DeepSeek V4-Pro";

function deepSeekAnswer(question: Question) {
  return question.responses.find((response) => response.label === DEEPSEEK_LABEL);
}

function buildQuestionPack(question: Question) {
  const answer = deepSeekAnswer(question);
  return [
    `【司律備考｜DeepSeek 第 ${question.id} 題】`,
    `題目：${question.prompt}`,
    `正確法律判準：${question.rule}`,
    `預期方向：${question.expected}`,
    `致命錯誤：${question.fatal.join("、") || "依通用規則"}`,
    "",
    "【DeepSeek 回答】",
    answer?.text || "（本題尚未完成）",
    `Token：${answer ? answer.inputTokens + answer.outputTokens : "—"}｜成本：${answer ? `US$ ${(answer.estimatedCostUsdMicros / 1e6).toFixed(6)}` : "—"}｜耗時：${answer ? `${(answer.durationMs / 1000).toFixed(1)} 秒` : "—"}`,
  ].join("\n");
}

function buildFullPack(questions: Question[]) {
  const complete = questions.filter(deepSeekAnswer);
  return [
    "【司律備考｜DeepSeek 50 題完整評測】",
    "以下為同一個 DeepSeek 模型連續完成的 50 題。請先逐題評分，再統計平均分、中位數、最低分、致命錯誤率、五項能力、前後段品質漂移、常見錯誤、總 Token、總成本、平均速度，最後判斷是否適合用於學爭點與智能書。",
    "評分面向：法律正確性 35、涵攝完整度 25、忠於題目 15、法源可靠性 10、教學表達 15。致命錯誤以 ! 標記。",
    "",
    ...complete.flatMap((question) => [buildQuestionPack(question), "", "────────────────────", ""]),
  ].join("\n");
}

export default function ModelLab() {
  const [data, setData] = useState<Data | null>(null);
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [view, setView] = useState<"results" | "questions" | "history">("results");
  const stopRequested = useRef(false);

  const load = async (runId?: string) => {
    const response = await fetch(`/api/model-evaluation${runId ? `?runId=${encodeURIComponent(runId)}` : ""}`);
    const result = await response.json().catch(() => ({ error: "伺服器沒有回傳可讀資料" })) as Data & { error?: string };
    if (!response.ok) {
      setError(`測試資料讀取失敗：${result.error || response.status}`);
      throw new Error(result.error);
    }
    setError("");
    setData(result);
    return result;
  };

  useEffect(() => { void load().catch(() => undefined); }, []);

  const completedQuestions = useMemo(() => (data?.questions ?? []).filter(deepSeekAnswer), [data]);
  const answered = completedQuestions.length;
  const total = data?.target ?? 50;
  const current = data?.runs.find((run) => run.id === data.runId);
  const totals = useMemo(() => completedQuestions.reduce((sum, question) => {
    const response = deepSeekAnswer(question)!;
    sum.tokens += response.inputTokens + response.outputTokens;
    sum.cost += response.estimatedCostUsdMicros / 1e6;
    sum.duration += response.durationMs;
    return sum;
  }, { tokens: 0, cost: 0, duration: 0 }), [completedQuestions]);

  async function startRun() {
    if (running) return;
    if (answered > 0 && answered < total && !confirm("目前批次尚未完成。建立新一輪會重新產生 DeepSeek 費用，仍要建立嗎？")) return;
    const response = await fetch("/api/model-evaluation", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "create-run", mode: "deepseek-only" }) });
    const result = await response.json() as { runId?: string; error?: string };
    if (!response.ok || !result.runId) { setError(result.error || "無法建立測試批次"); return; }
    await load(result.runId);
    setStatus("新測試已建立，可開始連續測試 50 題");
  }

  async function runAll() {
    if (!data?.runId || running) return;
    setRunning(true);
    setError("");
    stopRequested.current = false;
    let snapshot = data;
    for (const question of snapshot.questions) {
      if (stopRequested.current) { setStatus(`已暫停；下次將從第 ${question.id} 題繼續`); break; }
      if (deepSeekAnswer(question)) continue;
      setStatus(`DeepSeek 正在回答第 ${question.id}／${total} 題…`);
      const response = await fetch("/api/model-evaluation", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ runId: snapshot.runId, questionId: question.id, provider: "deepseek" }) });
      const result = await response.json().catch(() => ({ error: "沒有可讀回應" })) as { error?: string };
      if (!response.ok) {
        setError(`第 ${question.id} 題失敗：${result.error || "未知錯誤"}。已完成題目均已保存，可直接按「繼續未完成題目」重試。`);
        break;
      }
      snapshot = await load(snapshot.runId || undefined);
    }
    const finalData = await load(snapshot.runId || undefined).catch(() => snapshot);
    const finalCount = finalData.questions.filter(deepSeekAnswer).length;
    if (finalCount === total) setStatus("50 題已全部完成，可以一次複製完整內容交給 ChatGPT 總評");
    setRunning(false);
  }

  function pause() {
    stopRequested.current = true;
    setStatus("會在目前這一題完成後暫停…");
  }

  async function copyFullPack() {
    if (!data || answered !== total) return;
    await navigator.clipboard.writeText(buildFullPack(data.questions));
    setStatus("50 題完整評測內容已複製，可直接貼到 ChatGPT");
  }

  return <main className="model-lab-shell">
    <header className="model-lab-top">
      <Link href="/" className="model-lab-brand"><span>律</span><div><b>DeepSeek 法律模型測試</b><small>單一模型 · 連續完成 50 題</small></div></Link>
      <nav><button className={view === "results" ? "active" : ""} onClick={() => setView("results")}>本輪測試</button><button className={view === "questions" ? "active" : ""} onClick={() => setView("questions")}>查看 50 題</button><button className={view === "history" ? "active" : ""} onClick={() => setView("history")}>歷次測試</button><Link href="/">回到司律備考</Link></nav>
    </header>
    <section className="model-lab-hero"><div><span className="eyebrow">DEEPSEEK 50-QUESTION BENCHMARK</span><h1>一次跑完 50 題，最後統一評論</h1><p>固定使用 DeepSeek；每題完成立即保存，中斷後可從未完成題目繼續。</p></div><div className="lab-progress"><b>{answered}<small> / {total} 題</small></b><span>{current?.label || "尚未建立測試"}</span><div><i style={{ width: `${total ? answered / total * 100 : 0}%` }} /></div><small>{status || "等待開始"}</small></div></section>

    {view === "results" && <section className="results-panel">
      <div className="benchmark-actions"><div><b>{data?.runId ? `目前批次｜${current?.label || data.runId}` : "尚未建立測試批次"}</b><span>只呼叫 DeepSeek；不逐題暫停、不使用其他模型、不產生裁判模型費用</span></div><div className="benchmark-buttons"><button className="secondary" onClick={() => void startRun()} disabled={running}>＋ 開始新一輪</button>{running ? <button className="pause-button" onClick={pause}>完成本題後暫停</button> : <button onClick={() => void runAll()} disabled={!data?.runId || answered === total}>{answered ? "繼續未完成題目" : "開始連續測試 50 題"}</button>}</div></div>
      {error && <div className="benchmark-error"><b>測試已暫停</b><span>{error}</span></div>}
      <div className="summary-strip"><div><span>已完成</span><b>{answered}</b><small>共 {total} 題</small></div><div><span>總 Token</span><b>{totals.tokens.toLocaleString()}</b><small>輸入＋輸出</small></div><div><span>模型成本</span><b>NT$ {(totals.cost * 32.5).toFixed(2)}</b><small>US$ {totals.cost.toFixed(4)}</small></div><div><span>平均耗時</span><b>{answered ? (totals.duration / answered / 1000).toFixed(1) : "—"} 秒</b><small>每題平均</small></div></div>
      <section className="manual-score-card"><header><div><span>{answered === total ? "READY FOR FINAL REVIEW" : "RUNNING RECORD"}</span><h2>{answered === total ? "50 題完成，交給 ChatGPT 一次總評" : `已安全保存 ${answered} 題`}</h2></div><b>DeepSeek V4-Pro</b></header><div className="manual-score-actions"><button onClick={() => void copyFullPack()} disabled={answered !== total}>複製 50 題完整評測內容</button><small>{answered === total ? "複製後直接貼回目前對話，我會逐題評分並提供整體穩定性分析。" : "完成 50 題後才會開放完整複製；中途離開不會遺失已完成結果。"}</small></div><details><summary>查看目前已完成的回答</summary><pre>{completedQuestions.map(buildQuestionPack).join("\n\n────────────────────\n\n") || "尚未產生回答。"}</pre></details></section>
    </section>}

    {view === "questions" && <QuestionBank questions={data?.questions ?? []} />}
    {view === "history" && <section className="history-panel"><header><div><span>RUN HISTORY</span><h2>歷次測試紀錄</h2></div><small>舊的四模型比較資料仍完整保留</small></header><div className="run-table"><div className="run-row run-head"><span>測試批次</span><span>完成狀態</span><span>狀態</span><span>查看</span></div>{[...(data?.runs || [])].reverse().map((run) => <div className="run-row" key={run.id}><span><b>{run.label}</b><small>{run.id}</small></span><span>{run.answered ?? run.completed}/{run.total}</span><span className={(run.answered ?? 0) >= run.total ? "safe" : "warning"}>{(run.answered ?? 0) >= run.total ? "完整測試" : "進行中"}</span><span><button onClick={async () => { await load(run.id); setView("results"); }}>查看</button></span></div>)}</div></section>}
  </main>;
}

function QuestionBank({ questions }: { questions: Question[] }) {
  return <section className="question-bank"><header><div><span>BENCHMARK QUESTION BANK</span><h2>50 題完整題庫與評分標準</h2></div><small>固定題目，僅由 DeepSeek 連續作答</small></header>{questions.map((question) => <details key={question.id}><summary><i>{String(question.id).padStart(2, "0")}</i><span><b>{question.title}</b><small>{question.group} · {question.subject} · {deepSeekAnswer(question) ? "已完成" : "未作答"}</small></span></summary><div className="question-bank-body"><section><b>實際送出題目</b><p>{question.prompt}</p></section><section className="standard-card"><b>人工評分標準卡</b><dl><dt>正確法律判準</dt><dd>{question.rule}</dd><dt>預期方向</dt><dd>{question.expected}</dd><dt>致命錯誤</dt><dd>{question.fatal.join("、") || "依通用規則"}</dd></dl></section></div></details>)}</section>;
}
