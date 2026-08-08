"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type Evaluation = { id: number; score: number; fatal?: string[]; note?: string; weighted?: number; disqualified?: boolean };
type ModelResponse = { id: number; label: string; model: string; text: string; inputTokens: number; outputTokens: number; durationMs: number; estimatedCostUsdMicros: number; error?: string | null; evaluations: Evaluation[] };
type Comparison = { id: number; sequence: number; promptText: string; sourceStatus: string; createdAt: string; responses: ModelResponse[] };
type Data = { target: number; comparisons: Comparison[] };
type Rubric = { rule: number; application: number; premise: number; facts: number; sources: number; continuity: number; teaching: number; fatal: string[]; note: string };

const criteria: Array<{ key: keyof Omit<Rubric, "fatal" | "note">; label: string; weight: string }> = [
  { key: "rule", label: "法律判準正確", weight: "25%" }, { key: "application", label: "涵攝與結論", weight: "20%" },
  { key: "premise", label: "不迎合錯誤前提", weight: "15%" }, { key: "facts", label: "不偷加／遺漏事實", weight: "15%" },
  { key: "sources", label: "教材與法源", weight: "10%" }, { key: "continuity", label: "承接多輪對話", weight: "10%" },
  { key: "teaching", label: "教學表達", weight: "5%" },
];
const fatalLabels = ["虛構法源或教材", "偷加關鍵事實", "核心法律判準錯誤", "把爭議見解說成唯一答案", "迎合錯誤前提並肯定錯誤結論"];
const freshRubric = (): Rubric => ({ rule: 0, application: 0, premise: 0, facts: 0, sources: 0, continuity: 0, teaching: 0, fatal: [], note: "" });

export default function ModelLab() {
  const [data, setData] = useState<Data | null>(null);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [drafts, setDrafts] = useState<Record<number, Rubric>>({});
  const [saving, setSaving] = useState<number | null>(null);
  const [tab, setTab] = useState<"evaluate" | "results">("evaluate");
  const load = () => fetch("/api/model-evaluation").then((r) => r.json()).then((value) => { setData(value); setActiveId((id) => id ?? value.comparisons?.[0]?.id ?? null); });
  useEffect(() => { void load(); }, []);
  const active = data?.comparisons.find((item) => item.id === activeId) ?? data?.comparisons[0];
  const evaluatedResponses = useMemo(() => data?.comparisons.flatMap((item) => item.responses).filter((item) => item.evaluations.length) ?? [], [data]);
  const leaderboard = useMemo(() => {
    const map = new Map<string, { model: string; label: string; scores: number[]; fatal: number; cost: number; duration: number }>();
    for (const response of evaluatedResponses) { const row = map.get(response.model) ?? { model: response.model, label: response.label, scores: [], fatal: 0, cost: 0, duration: 0 }; const latest = response.evaluations.at(-1)!; row.scores.push(latest.score); row.fatal += latest.disqualified ? 1 : 0; row.cost += response.estimatedCostUsdMicros; row.duration += response.durationMs; map.set(response.model, row); }
    return [...map.values()].map((row) => ({ ...row, average: row.scores.reduce((a, b) => a + b, 0) / row.scores.length, pass: row.scores.filter((s) => s >= 70).length / row.scores.length * 100, costPerPass: row.cost / 1_000_000 / Math.max(1, row.scores.filter((s) => s >= 70).length) })).sort((a, b) => b.average - a.average);
  }, [evaluatedResponses]);
  async function save(response: ModelResponse) { const rubric = drafts[response.id] ?? freshRubric(); setSaving(response.id); const result = await fetch("/api/model-evaluation", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ responseId: response.id, rubric }) }); setSaving(null); if (result.ok) await load(); }
  const completed = new Set(evaluatedResponses.map((item) => item.id)).size;
  const totalResponses = data?.comparisons.reduce((sum, item) => sum + item.responses.length, 0) ?? 0;
  return <main className="model-lab-shell">
    <header className="model-lab-top"><Link href="/" className="model-lab-brand"><span>律</span><div><b>模型盲測實驗室</b><small>司律備考 · 法律教學品質驗證</small></div></Link><nav><button className={tab === "evaluate" ? "active" : ""} onClick={() => setTab("evaluate")}>逐題評測</button><button className={tab === "results" ? "active" : ""} onClick={() => setTab("results")}>統計比較</button><Link href="/admin">管理後台</Link></nav></header>
    <section className="model-lab-hero"><div><span className="eyebrow">50 題正式測試</span><h1>{tab === "evaluate" ? "看法律品質，不只看文字漂亮" : "哪個模型，真正適合法律教學？"}</h1><p>{tab === "evaluate" ? "同題、同教材、同對話歷史。依固定標準盲評，致命錯誤直接不合格。" : "同時比較法律正確性、致命錯誤率、速度與每則合格回答成本。"}</p></div><div className="lab-progress"><b>{data?.comparisons.length ?? 0}<small> / {data?.target ?? 50} 題</small></b><span>已建立測試</span><div><i style={{ width: `${Math.min(100, ((data?.comparisons.length ?? 0) / (data?.target ?? 50)) * 100)}%` }} /></div><small>{completed} / {totalResponses} 則回答完成評分</small></div></section>
    {tab === "evaluate" ? <div className="model-lab-grid"><aside className="question-rail"><div className="rail-title"><b>測試題目</b><span>{data?.comparisons.length ?? 0} 題</span></div>{data?.comparisons.map((item) => { const done = item.responses.length > 0 && item.responses.every((r) => r.evaluations.length); return <button key={item.id} className={active?.id === item.id ? "active" : ""} onClick={() => setActiveId(item.id)}><span>{done ? "✓" : String(item.sequence).padStart(2, "0")}</span><div><b>{item.promptText.slice(0, 42)}</b><small>{done ? "評分完成" : `${item.responses.length} 個模型待評`}</small></div></button>; })}</aside>
      <section className="evaluation-workspace">{active ? <><div className="question-card"><span>TEST {String(active.sequence).padStart(2, "0")}</span><h2>{active.promptText}</h2><div><b>{active.sourceStatus === "verified" ? "教材章節已核對" : active.sourceStatus === "full_text_search" ? "命中教材全文，頁碼待核對" : "未取得可核對教材"}</b><small>{new Date(active.createdAt).toLocaleString("zh-TW")}</small></div></div>
        <div className="response-stack">{active.responses.map((response, index) => { const draft = drafts[response.id] ?? freshRubric(); const last = response.evaluations.at(-1); return <article className="evaluation-card" key={response.id}><header><span className="blind-badge">回答 {String.fromCharCode(65 + index)}</span><div><b className="model-reveal">{response.label}</b><small>{response.model}</small></div>{last && <strong className={last.disqualified ? "failed" : "scored"}>{last.disqualified ? "不合格" : `${last.score} 分`}</strong>}</header><div className="answer-copy">{response.error || response.text}</div><div className="answer-metrics"><span>{(response.inputTokens + response.outputTokens).toLocaleString()} tokens</span><span>{(response.durationMs / 1000).toFixed(1)} 秒</span><span>NT$ {(response.estimatedCostUsdMicros / 1_000_000 * 32.5).toFixed(3)}</span></div>
          <div className="rubric-grid">{criteria.map((criterion) => <label key={criterion.key}><span>{criterion.label}<em>{criterion.weight}</em></span><select value={draft[criterion.key]} onChange={(e) => setDrafts((all) => ({ ...all, [response.id]: { ...draft, [criterion.key]: Number(e.target.value) } }))}><option value="0">未評</option>{[1,2,3,4,5].map((score) => <option key={score} value={score}>{score} 分</option>)}</select></label>)}</div>
          <fieldset className="fatal-checks"><legend>致命錯誤｜勾選任一項即不合格</legend>{fatalLabels.map((label) => <label key={label}><input type="checkbox" checked={draft.fatal.includes(label)} onChange={() => setDrafts((all) => ({ ...all, [response.id]: { ...draft, fatal: draft.fatal.includes(label) ? draft.fatal.filter((x) => x !== label) : [...draft.fatal, label] } }))}/><span>{label}</span></label>)}</fieldset>
          <textarea rows={3} value={draft.note} onChange={(e) => setDrafts((all) => ({ ...all, [response.id]: { ...draft, note: e.target.value } }))} placeholder="記錄錯誤位置、正確判準或值得保留的說理…" />
          <button className="save-evaluation" disabled={saving === response.id || criteria.some((c) => draft[c.key] === 0)} onClick={() => void save(response)}>{saving === response.id ? "儲存中…" : last ? "更新這次評分" : "完成並儲存評分"}</button></article>; })}</div></> : <div className="lab-empty">尚未產生模型比較。請先在首頁選擇比較模式送出題目。</div>}</section></div>
      : <section className="results-panel"><div className="summary-strip"><div><span>完成評分</span><b>{completed}</b><small>則模型回答</small></div><div><span>目前領先</span><b>{leaderboard[0]?.label ?? "—"}</b><small>{leaderboard[0] ? `${leaderboard[0].average.toFixed(1)} 分` : "等待資料"}</small></div><div><span>致命錯誤</span><b>{leaderboard.reduce((sum, row) => sum + row.fatal, 0)}</b><small>發生即不合格</small></div><div><span>合格門檻</span><b>70</b><small>分以上且無致命錯誤</small></div></div><div className="leaderboard"><header><div><span>MODEL RANKING</span><h2>模型總排行</h2></div><small>依平均法律品質分排序</small></header>{leaderboard.length ? <div className="leader-table"><div className="leader-row leader-head"><span>排名／模型</span><span>平均分</span><span>合格率</span><span>致命錯誤率</span><span>平均耗時</span><span>合格回答成本</span></div>{leaderboard.map((row, index) => <div className="leader-row" key={row.model}><span><i>{index + 1}</i><b>{row.label}</b><small>{row.model}</small></span><span><strong>{row.average.toFixed(1)}</strong> / 100</span><span>{row.pass.toFixed(0)}%</span><span className={row.fatal ? "danger" : "safe"}>{(row.fatal / row.scores.length * 100).toFixed(0)}%</span><span>{(row.duration / row.scores.length / 1000).toFixed(1)} 秒</span><span>NT$ {(row.costPerPass * 32.5).toFixed(3)}</span></div>)}</div> : <div className="lab-empty">完成第一批評分後，這裡會自動產生模型排行與成本效益。</div>}</div><p className="results-note">正式決策時建議至少完成 50 題，並同時查看各題型分數；總平均不能掩蓋「迎合錯誤前提」或「虛構法源」等致命錯誤。</p></section>}
  </main>;
}
