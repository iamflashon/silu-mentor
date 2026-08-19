"use client";

import { useEffect, useState } from "react";

type SolutionStep = {
  step: number;
  title: string;
  focus: string;
  analysis: string;
  student_performance: string;
  next_action: string;
};

type EssayGrading = {
  score: number;
  max_score?: number;
  overall: string;
  solution_steps?: SolutionStep[];
  dimensions: Array<{
    criterion: string;
    score: number;
    max_score: number;
    result: string;
    evidence: string;
    missing: string;
  }>;
  strengths: string[];
  priority_fixes: string[];
  next_step: string;
  source_used: string;
};

type EssayAttempt = {
  id: number;
  questionId: number;
  year: string;
  subject: string;
  questionNumber: string;
  stem: string;
  answer: string;
  savedAt: string;
  mode: "sol" | "claude" | "dual";
  grading?: EssayGrading;
  reviews?: { sol?: EssayGrading; claude?: EssayGrading };
  comparison?: {
    scoreDifference: number;
    agreements: string[];
    differences: Array<{ criterion: string; sol: number; claude: number }>;
  } | null;
  usage?: Array<{ model: string; inputTokens: number; cachedTokens: number; outputTokens: number; estimatedCostUsdMicros: number }>;
};

function asText(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function asNumber(value: unknown, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function normalizeGrading(value: unknown): EssayGrading | null {
  if (!value || typeof value !== "object") return null;
  const source = value as Record<string, unknown>;
  const solutionSteps = Array.isArray(source.solution_steps)
    ? source.solution_steps.flatMap((item, index) => {
        if (!item || typeof item !== "object") return [];
        const step = item as Record<string, unknown>;
        return [{
          step: Math.max(1, Math.round(asNumber(step.step, index + 1))),
          title: asText(step.title, `解題步驟 ${index + 1}`),
          focus: asText(step.focus),
          analysis: asText(step.analysis),
          student_performance: asText(step.student_performance),
          next_action: asText(step.next_action),
        }];
      })
    : [];
  const dimensions = Array.isArray(source.dimensions)
    ? source.dimensions.flatMap((item) => {
        if (!item || typeof item !== "object") return [];
        const dimension = item as Record<string, unknown>;
        return [{
          criterion: asText(dimension.criterion, "未命名採分項目"),
          score: asNumber(dimension.score),
          max_score: asNumber(dimension.max_score, 0),
          result: asText(dimension.result),
          evidence: asText(dimension.evidence),
          missing: asText(dimension.missing),
        }];
      })
    : [];
  const strings = (field: unknown) => Array.isArray(field)
    ? field.filter((item): item is string => typeof item === "string")
    : [];
  return {
    score: asNumber(source.score),
    max_score: asNumber(source.max_score) || undefined,
    overall: asText(source.overall, "這筆批改已有保存，但部分批改欄位是早期格式。"),
    solution_steps: solutionSteps,
    dimensions,
    strengths: strings(source.strengths),
    priority_fixes: strings(source.priority_fixes),
    next_step: asText(source.next_step, "請回到練真題重新批改，以取得完整解題步驟。"),
    source_used: asText(source.source_used),
  };
}

function modeLabel(mode: EssayAttempt["mode"], model?: string) {
  return mode === "dual" ? "Sol＋Claude 雙模型覆核" : mode === "claude" ? "Claude Opus 5" : model?.includes("luna") ? "GPT-5.6 Luna" : "GPT-5.6 Sol";
}

function dateLabel(value: string) {
  if (!value) return "時間未標示";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-TW", { dateStyle: "medium", timeStyle: "short" });
}

function GradingView({ grading, title }: { grading: EssayGrading; title?: string }) {
  return (
    <div className="essay-history-grading">
      {title && <h4>{title}</h4>}
      <div className="essay-history-score"><b>{grading.score}</b><span>/ {grading.max_score ?? (grading.dimensions.reduce((sum, item) => sum + item.max_score, 0) || 100)}</span></div>
      <p className="essay-history-overall">{grading.overall}</p>
      <div className="essay-history-dimensions">
        {grading.dimensions.map((item) => (
          <article key={`${item.criterion}-${item.score}-${item.max_score}`}>
            <strong>{item.criterion}　{item.score}/{item.max_score}</strong>
            <p>{item.result}</p>
            {item.evidence && <small><b>已做到／原文證據：</b>{item.evidence}</small>}
            {item.missing && <small><b>寫錯、遺漏與補強：</b>{item.missing}</small>}
          </article>
        ))}
      </div>
      {grading.priority_fixes.length > 0 && <div className="essay-history-fixes"><strong>優先修正</strong><ul>{grading.priority_fixes.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}</ul></div>}
      <div className="essay-history-next"><strong>下一步</strong><p>{grading.next_step}</p></div>
    </div>
  );
}

export function EssayHistory({ onBack }: { onBack: () => void }) {
  const [attempts, setAttempts] = useState<EssayAttempt[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [page, setPage] = useState(1);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    fetch("/api/essay-grading")
      .then(async (response) => {
        const result = (await response.json()) as { attempts?: EssayAttempt[]; error?: string };
        if (!response.ok) throw new Error(result.error ?? "批改紀錄暫時無法讀取");
        setAttempts(result.attempts ?? []);
      })
      .catch((reason) => setError(reason instanceof Error ? reason.message : "批改紀錄暫時無法讀取"))
      .finally(() => setLoading(false));
  }, []);

  const pageSize = 10;
  const pageCount = Math.max(1, Math.ceil(attempts.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const visibleAttempts = attempts.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const visibleIds = visibleAttempts.map((attempt) => attempt.id);
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.has(id));

  function toggleSelected(id: number) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleAllVisible() {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (allVisibleSelected) visibleIds.forEach((id) => next.delete(id));
      else visibleIds.forEach((id) => next.add(id));
      return next;
    });
  }

  async function deleteSelected() {
    const ids = [...selectedIds];
    if (!ids.length || !window.confirm(`確定要刪除選取的 ${ids.length} 筆批改紀錄嗎？刪除後無法復原。`)) return;
    setDeleting(true);
    setError("");
    try {
      const response = await fetch("/api/essay-grading", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ ids }) });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "批改紀錄刪除失敗");
      setAttempts((current) => current.filter((attempt) => !selectedIds.has(attempt.id)));
      setSelectedIds(new Set());
      setPage((current) => Math.min(current, Math.max(1, Math.ceil((attempts.length - ids.length) / pageSize))));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "批改紀錄刪除失敗");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <section className="essay-history-hub" aria-label="我的申論批改紀錄">
      <header className="essay-history-head">
        <div>
          <button type="button" className="essay-history-back" onClick={onBack}>← 返回寫申論</button>
          <p>ESSAY GRADING HISTORY</p>
          <h2>我的申論批改</h2>
          <span>每次送出後會自動保存；你可以回看原答案、解題步驟、分項評分與下一步。</span>
        </div>
        <strong>{attempts.length} 筆</strong>
      </header>
      {!loading && !error && attempts.length > 0 && <div className="essay-history-toolbar">
        <label><input type="checkbox" checked={allVisibleSelected} onChange={toggleAllVisible} /> 全選本頁</label>
        <span>已選 {selectedIds.size} 筆</span>
        <button type="button" onClick={() => void deleteSelected()} disabled={!selectedIds.size || deleting}>{deleting ? "刪除中…" : "刪除選取紀錄"}</button>
      </div>}
      {loading && <div className="essay-history-empty">正在讀取已保存的批改…</div>}
      {!loading && error && <div className="essay-history-empty is-error">{error}</div>}
      {!loading && !error && attempts.length === 0 && <div className="essay-history-empty">完成第一次申論批改後，結果會自動出現在這裡。</div>}
      {!loading && !error && attempts.length > 0 && (
        <div className="essay-history-list">
          {visibleAttempts.map((attempt) => {
            const solGrading = normalizeGrading(attempt.reviews?.sol);
            const claudeGrading = normalizeGrading(attempt.reviews?.claude);
            const primary = attempt.mode === "dual"
              ? solGrading ?? claudeGrading
              : normalizeGrading(attempt.grading);
            const hasDualReviews = attempt.mode === "dual" && solGrading && claudeGrading;
            return (
              <details className="essay-history-card" key={attempt.id}>
                <summary>
                  <span className="essay-history-summary-main"><input type="checkbox" checked={selectedIds.has(attempt.id)} onClick={(event) => event.stopPropagation()} onChange={() => toggleSelected(attempt.id)} aria-label={`選取 ${attempt.year} ${attempt.subject} 第 ${attempt.questionNumber} 題`} /><span><b>{attempt.year}｜{attempt.subject}｜第 {attempt.questionNumber} 題</b><small>{dateLabel(attempt.savedAt)} · {modeLabel(attempt.mode, attempt.model ?? attempt.usage?.[0]?.model)} · {attempt.usage?.length ? `${attempt.usage.reduce((sum, item) => sum + item.inputTokens + item.outputTokens, 0).toLocaleString()} tokens · US$ ${(attempt.usage.reduce((sum, item) => sum + item.estimatedCostUsdMicros, 0) / 1_000_000).toFixed(5)}` : "成本資料待重新批改"} · 已自動保存</small></span></span>
                  <strong>{primary ? `${primary.score} 分` : "查看結果"}</strong>
                </summary>
                <div className="essay-history-body">
                  <section className="essay-history-question"><h3>題目</h3><p>{attempt.stem}</p></section>
                  <section className="essay-history-answer"><h3>我的作答</h3><pre>{attempt.answer}</pre></section>
                  {hasDualReviews ? (
                    <section className="essay-history-dual">
                      <div className="essay-history-dual-head"><strong>雙模型覆核結果</strong>{attempt.comparison && <span>總分差距 {attempt.comparison.scoreDifference} 分</span>}</div>
                      <div className="essay-history-dual-grid"><GradingView grading={solGrading} title="GPT-5.6 Sol" /><GradingView grading={claudeGrading} title="Claude Opus 5" /></div>
                      {attempt.comparison && <div className="essay-history-comparison"><b>覆核摘要</b>{attempt.comparison.agreements.length > 0 && <p>配分一致：{attempt.comparison.agreements.join("、")}</p>}{attempt.comparison.differences.length > 0 && <p>配分差異：{attempt.comparison.differences.map((item) => `${item.criterion}（Sol ${item.sol}／Claude ${item.claude}）`).join("、")}</p>}</div>}
                    </section>
                  ) : primary ? <GradingView grading={primary} title={attempt.mode === "dual" ? "可用的模型批改結果" : modeLabel(attempt.mode, attempt.model ?? attempt.usage?.[0]?.model)} /> : (
                    <div className="essay-history-empty is-error">這筆紀錄只有作答內容，批改欄位格式較舊；請回到練真題重新批改。</div>
                  )}
                </div>
              </details>
            );
          })}
        </div>
      )}
      {!loading && !error && attempts.length > pageSize && <nav className="document-pagination essay-history-pagination" aria-label="批改紀錄分頁">
        <button type="button" disabled={currentPage === 1} onClick={() => setPage((value) => value - 1)}>上一頁</button>
        <span>第 {currentPage} / {pageCount} 頁（每頁 10 題）</span>
        <button type="button" disabled={currentPage >= pageCount} onClick={() => setPage((value) => value + 1)}>下一頁</button>
      </nav>}
    </section>
  );
}
