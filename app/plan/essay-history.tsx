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
};

function modeLabel(mode: EssayAttempt["mode"]) {
  return mode === "dual" ? "Sol＋Claude 雙模型覆核" : mode === "claude" ? "Claude Opus 5" : "GPT-5.6 Sol";
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
      <div className="essay-history-score"><b>{grading.score}</b><span>/ 100</span></div>
      <p className="essay-history-overall">{grading.overall}</p>
      {grading.solution_steps?.length ? (
        <section className="essay-solution-steps" aria-label="解題過程步驟">
          <header><strong>解題過程步驟</strong><span>依序看審題、爭點、規範、涵攝與結論</span></header>
          <ol>
            {grading.solution_steps.map((step, index) => (
              <li key={`${step.step}-${step.title}-${index}`}>
                <div className="essay-solution-step-head"><b>{step.step || index + 1}</b><strong>{step.title}</strong></div>
                <p><em>本步處理</em>{step.focus}</p>
                <p><em>解題分析</em>{step.analysis}</p>
                <p><em>你的表現</em>{step.student_performance}</p>
                <p><em>下一動作</em>{step.next_action}</p>
              </li>
            ))}
          </ol>
        </section>
      ) : null}
      <div className="essay-history-dimensions">
        {grading.dimensions.map((item) => (
          <article key={item.criterion}>
            <strong>{item.criterion}　{item.score}/{item.max_score}</strong>
            <p>{item.result}</p>
            {item.evidence && <small>你的作答依據：{item.evidence}</small>}
            {item.missing && <small>待補強：{item.missing}</small>}
          </article>
        ))}
      </div>
      {grading.priority_fixes.length > 0 && <div className="essay-history-fixes"><strong>優先修正</strong><ul>{grading.priority_fixes.map((item) => <li key={item}>{item}</li>)}</ul></div>}
      <div className="essay-history-next"><strong>下一步</strong><p>{grading.next_step}</p></div>
    </div>
  );
}

export function EssayHistory() {
  const [attempts, setAttempts] = useState<EssayAttempt[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

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

  return (
    <section className="essay-history-hub" aria-label="我的申論批改紀錄">
      <header className="essay-history-head">
        <div>
          <p>ESSAY GRADING HISTORY</p>
          <h2>我的申論批改</h2>
          <span>每次送出後會自動保存；你可以回看原答案、解題步驟、分項評分與下一步。</span>
        </div>
        <strong>{attempts.length} 筆</strong>
      </header>
      {loading && <div className="essay-history-empty">正在讀取已保存的批改…</div>}
      {!loading && error && <div className="essay-history-empty is-error">{error}</div>}
      {!loading && !error && attempts.length === 0 && <div className="essay-history-empty">完成第一次申論批改後，結果會自動出現在這裡。</div>}
      {!loading && !error && attempts.length > 0 && (
        <div className="essay-history-list">
          {attempts.map((attempt) => {
            const primary = attempt.mode === "dual" ? attempt.reviews?.sol : attempt.grading;
            return (
              <details className="essay-history-card" key={attempt.id}>
                <summary>
                  <span><b>{attempt.year}｜{attempt.subject}｜第 {attempt.questionNumber} 題</b><small>{dateLabel(attempt.savedAt)} · {modeLabel(attempt.mode)} · 已自動保存</small></span>
                  <strong>{primary ? `${primary.score} 分` : "查看結果"}</strong>
                </summary>
                <div className="essay-history-body">
                  <section className="essay-history-question"><h3>題目</h3><p>{attempt.stem}</p></section>
                  <section className="essay-history-answer"><h3>我的作答</h3><pre>{attempt.answer}</pre></section>
                  {attempt.mode === "dual" && attempt.reviews?.sol && attempt.reviews.claude ? (
                    <section className="essay-history-dual">
                      <div className="essay-history-dual-head"><strong>雙模型覆核結果</strong>{attempt.comparison && <span>總分差距 {attempt.comparison.scoreDifference} 分</span>}</div>
                      <div className="essay-history-dual-grid"><GradingView grading={attempt.reviews.sol} title="GPT-5.6 Sol" /><GradingView grading={attempt.reviews.claude} title="Claude Opus 5" /></div>
                      {attempt.comparison && <div className="essay-history-comparison"><b>覆核摘要</b>{attempt.comparison.agreements.length > 0 && <p>配分一致：{attempt.comparison.agreements.join("、")}</p>}{attempt.comparison.differences.length > 0 && <p>配分差異：{attempt.comparison.differences.map((item) => `${item.criterion}（Sol ${item.sol}／Claude ${item.claude}）`).join("、")}</p>}</div>}
                    </section>
                  ) : primary ? <GradingView grading={primary} title={modeLabel(attempt.mode)} /> : null}
                </div>
              </details>
            );
          })}
        </div>
      )}
    </section>
  );
}
