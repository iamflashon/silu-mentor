"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import MedtechTabs from "../MedtechTabs";
import MedtechHeaderActions from "../MedtechHeaderActions";

type Question = {
  id: number;
  year: string;
  questionNumber: string;
  stem: string;
  options: Record<string, string>;
  answer: string;
  answerLabel?: string;
  explanation?: string;
  answerSource: string;
  subject: string;
  chapter?: string;
  topic?: string;
  hasFullExplanation?: boolean;
  fullExplanation?: string;
  locked?: boolean;
};

type ApiResult = {
  items?: Question[];
  error?: string;
  message?: string;
  sessionId?: number | null;
  packageAccess?: {
    name: string;
    cost: number;
    questionCount: number;
    days: number;
    locked: boolean;
    gifted?: boolean;
    charged?: boolean;
    availableUntil?: string | null;
  };
};

const letters = ["A", "B", "C", "D"];

async function readJson(response: Response) {
  const text = await response.text();
  if (!text.trim()) {
    throw new Error(response.ok ? "題庫沒有回傳資料，請稍後再試。" : "題庫服務暫時忙碌，請稍後重新整理。");
  }
  try {
    return JSON.parse(text) as ApiResult;
  } catch {
    throw new Error("題庫回應格式錯誤，請稍後重新整理。");
  }
}

export default function MedtechPractice() {
  const [rows, setRows] = useState<Question[]>([]);
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [submitted, setSubmitted] = useState(false);
  const [flagged, setFlagged] = useState<number[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [unlockingId, setUnlockingId] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [mastering, setMastering] = useState(false);
  const [fullNotice, setFullNotice] = useState("");
  const [sessionId, setSessionId] = useState<number | null>(null);
  const [packageAccess, setPackageAccess] = useState<NonNullable<ApiResult["packageAccess"]> | null>(null);
  const [paywallOpen, setPaywallOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [route, setRoute] = useState({ ready: false, topic: "", wrongOnly: false, focus: 0 });

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setRoute({
      ready: true,
      topic: params.get("topic") || "",
      wrongOnly: params.get("wrongOnly") === "1",
      focus: Number(params.get("focus")) || 0,
    });
  }, []);

  const { topic, wrongOnly, focus } = route;

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!route.ready) return;
    setLoading(true);
    setError("");
    setRows([]);
    setSessionId(null);
    setPackageAccess(null);
    setPaywallOpen(false);
    const query = new URLSearchParams({ limit: "30", mode: "practice" });
    if (topic) query.set("topic", topic);
    if (wrongOnly) query.set("wrongOnly", "1");
    fetch("/api/medtech/questions?" + query.toString())
      .then(async (response) => {
        const result = await readJson(response);
        if (!response.ok) throw new Error(result.error || "題庫讀取失敗");
        setRows(result.items ?? []);
        setSessionId(result.sessionId ?? null);
        setPackageAccess(result.packageAccess ?? null);
        if (focus && result.items?.length) {
          const focusedIndex = result.items.findIndex((item) => item.id === focus);
          if (focusedIndex >= 0) setIndex(focusedIndex);
        }
        if (!result.items?.length) setError(result.message || "目前沒有符合條件的醫檢師題目。");
      })
      .catch((reason) => setError(reason instanceof Error ? reason.message : "題庫讀取失敗"))
      .finally(() => setLoading(false));
  }, [route.ready, topic, wrongOnly]);

  const q = rows[index];
  const chapterName = wrongOnly ? "錯題複習" : q?.chapter || topic || q?.topic || "章節未標示";
  const score = useMemo(() => rows.filter((item) => answers[item.id] === item.answer).length, [answers, rows]);
  const answered = Object.keys(answers).length;
  const packageExpiry = packageAccess?.availableUntil ? new Date(packageAccess.availableUntil).getTime() : null;
  const packageRemaining = packageExpiry ? Math.max(0, packageExpiry - now) : null;
  const formatRemaining = (milliseconds: number) => {
    const totalMinutes = Math.floor(milliseconds / 60000);
    const days = Math.floor(totalMinutes / 1440);
    const hours = Math.floor((totalMinutes % 1440) / 60);
    const minutes = totalMinutes % 60;
    return days > 0 ? `${days} 天 ${hours} 小時` : hours > 0 ? `${hours} 小時 ${minutes} 分` : `${minutes} 分鐘`;
  };

  const top = (
    <>
      <header className="medtech-top" data-no-navigation-feedback>
        <a href="/medtech" className="medtech-brand">
          <span>醫</span>
          <div>
            <b>醫檢師備考</b>
            <small>臨床病毒學</small>
          </div>
        </a>
        <MedtechHeaderActions />
      </header>
      <MedtechTabs active={wrongOnly ? "wrong" : "random"} />
    </>
  );

  async function submitExam() {
    if (submitting) return;
    if (q?.locked) {
      setPaywallOpen(true);
      return;
    }
    setSubmitting(true);
    setSubmitted(true);
    setIndex(0);
    setFullNotice("");
    try {
      const payload = Object.entries(answers).map(([questionId, answer]) => ({
        questionId: Number(questionId),
        answer,
      }));
      if (payload.length) {
        await fetch("/api/medtech/questions", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ answers: payload, sessionId }),
        }).catch(() => undefined);
      }
      const ids = rows.map((item) => item.id).join(",");
      if (ids) {
        const response = await fetch("/api/medtech/questions?mode=review&ids=" + ids + (sessionId ? `&sessionId=${sessionId}` : ""), { cache: "no-store" });
        const result = await readJson(response);
        if (response.ok) {
          setRows((current) => current.map((item) => {
            const detail = result.items?.find((next) => next.id === item.id);
            return detail ? { ...item, ...detail } : item;
          }));
        }
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function unlockFullExplanation(questionId: number) {
    if (unlockingId) return;
    setUnlockingId(questionId);
    setFullNotice("");
    try {
      const response = await fetch("/api/medtech/usage", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "completeExplanation", questionId }),
      });
      const result = (await response.json()) as { fullExplanation?: string; error?: string };
      if (response.status === 402) {
        setFullNotice(result.error || "點數已用完；完整解析每題扣 1 點，開啟後 24 小時內可重看，請先購買點數。");
        return;
      }
      if (!response.ok || !result.fullExplanation) throw new Error(result.error || "完整解析開啟失敗");
      setRows((current) =>
        current.map((item) => (item.id === questionId ? { ...item, fullExplanation: result.fullExplanation } : item)),
      );
    } catch (reason) {
      setFullNotice(reason instanceof Error ? reason.message : "完整解析開啟失敗");
    } finally {
      setUnlockingId(0);
    }
  }

  async function markMastered() {
    if (!wrongOnly || !q || mastering) return;
    setMastering(true);
    try {
      const response = await fetch("/api/medtech/questions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ masteredQuestionId: q.id }),
      });
      if (!response.ok) {
        setError("暫時無法移除這題，請稍後再試。");
        return;
      }
      const remaining = rows.filter((item) => item.id !== q.id);
      setRows(remaining);
      setAnswers((value) => {
        const next = { ...value };
        delete next[q.id];
        return next;
      });
      setFlagged((value) => value.filter((id) => id !== q.id));
      setIndex((current) => Math.min(current, Math.max(0, remaining.length - 1)));
      if (!remaining.length) setError("目前沒有待複習的錯題，你已完成這一輪複習。");
    } finally {
      setMastering(false);
    }
  }

  if (loading || error || !q) {
    return (
      <main className="medtech-practice">
        {top}
        <section className="medtech-result">
          <span>{loading ? "讀取中" : "題庫狀態"}</span>
          <h1>{loading ? "正在準備題目…" : error}</h1>
          {!loading && <Link href="/medtech">返回醫檢師首頁</Link>}
        </section>
      </main>
    );
  }

  if (submitted) {
    const userAnswer = answers[q.id] || "";
    const isCorrect = userAnswer === q.answer;
    return (
      <main className="medtech-practice medtech-review">
        {top}
        <section className="medtech-review-summary">
          <div>
            <span>{wrongOnly ? "錯題複習結果" : "本回成績"}</span>
            <b>
              {score}
              <small>／{rows.length}</small>
            </b>
            <p>{submitting ? <span className="medtech-loading-label"><i className="medtech-loading-spinner" aria-hidden="true"/>正在載入答案與解析…</span> : <>答對率 {Math.round((score / rows.length) * 100)}% · 已作答 {answered} 題</>}</p>
          </div>
          <button
            onClick={() => {
              setSubmitted(false);
              setIndex(0);
              setAnswers({});
              setFlagged([]);
              setFullNotice("");
            }}
          >
            {wrongOnly ? "再次複習" : "重新抽題"}
          </button>
        </section>
        <div className="medtech-exam-grid">
          <aside className="medtech-question-map">
            <header>
              <b>逐題檢討</b>
              <span>
                {index + 1}／{rows.length}
              </span>
            </header>
            <div>
              {rows.map((item, i) => {
                const picked = answers[item.id];
                return (
                  <button
                    key={item.id}
                    className={(i === index ? "active " : "") + (picked === item.answer ? "review-right" : "review-wrong")}
                    onClick={() => setIndex(i)}
                  >
                    {i + 1}
                  </button>
                );
              })}
            </div>
            <small>綠色＝答對 · 紅色＝答錯或未作答</small>
          </aside>
          <section className="medtech-question medtech-review-question">
            <header>
              <span>
                第 {index + 1} 題 · {q.year} 年專技
              </span>
              <strong className={isCorrect ? "review-status right" : "review-status wrong"}>{isCorrect ? "答對" : "答錯"}</strong>
            </header>
            <h2>{q.stem}</h2>
            <div className="medtech-review-answer-line">
              <span>
                你的答案：<b>{userAnswer || "未作答"}</b>
              </span>
              <span>
                {q.answerLabel || "答案"}：<b>{q.answer}</b>
              </span>
            </div>
            <div className="medtech-options medtech-review-options">
              {letters.map((letter) => (
                <div
                  className={(letter === q.answer ? "correct " : "") + (letter === userAnswer && letter !== q.answer ? "wrong" : "")}
                  key={letter}
                >
                  <b>{letter}</b>
                  <span>{q.options[letter]}</span>
                  {letter === q.answer && <em>{q.answerLabel || "正確答案"}</em>}
                  {letter === userAnswer && letter !== q.answer && <em>你的答案</em>}
                </div>
              ))}
            </div>
            <section className="medtech-explanation">
              <span>簡要解析</span>
              <p>{q.explanation?.trim() || "本題目前沒有可顯示的簡要解析。"}</p>
              {q.hasFullExplanation && !q.fullExplanation && (
                <button
                  className="medtech-full-explanation-button"
                  disabled={unlockingId === q.id}
                  onClick={() => void unlockFullExplanation(q.id)}
                >
                  {unlockingId === q.id ? "開啟中…" : "查看完整解析（扣 1 點／24 小時）"}
                </button>
              )}
              {q.fullExplanation && (
                <div className="medtech-full-explanation">
                  <b>完整解析</b>
                  <p>{q.fullExplanation}</p>
                </div>
              )}
              {fullNotice && (
                <small className="medtech-full-explanation-notice">
                  {fullNotice} <Link href="/medtech/upgrade?reason=ai-credits">前往購買點數</Link>
                </small>
              )}
              {q.answerLabel === "此為 AI 擬答" && <small className="ai-answer-notice">此為 AI 擬答，尚未有老師確認的標準答案。</small>}
              <small>來源：{q.answerSource || "題庫"}</small>
            </section>
            <footer>
              <button disabled={index === 0} onClick={() => setIndex(index - 1)}>
                上一題
              </button>
              <span>逐題核對作答與教材答案</span>
              <button disabled={index === rows.length - 1} onClick={() => setIndex(index + 1)}>
                下一題
              </button>
            </footer>
          </section>
        </div>
      </main>
    );
  }

  return (
    <main className="medtech-practice">
      {top}
      <section className="medtech-exam-head">
        <div>
          <span>{wrongOnly ? "個人錯題庫 · " + rows.length + " 題待複習" : packageAccess?.locked ? "題目包已列出 · 解鎖後開始作答" : "題目包 · 30 題 · 7 天不限次數"}</span>
          <h1>{chapterName}</h1>
          <p>
            第 {index + 1}／{rows.length} 題 · {q.year} 年專技
          </p>
        </div>
        <button onClick={() => void submitExam()} disabled={submitting} aria-busy={submitting}>{submitting ? <span className="medtech-loading-label"><i className="medtech-loading-spinner" aria-hidden="true"/>批改中…</span> : wrongOnly ? "完成複習" : q.locked ? "解鎖題目包" : "交卷"}</button>
      </section>
      {!wrongOnly && packageAccess && <section className={`medtech-package-status ${packageAccess.locked ? "locked" : "active"}`}>
        <div>
          <b>{packageAccess.locked ? "30 題已準備好，先解鎖再作答" : packageAccess.gifted ? "本章首次體驗：免費贈送一包" : "題目包已開通"}</b>
          <span>{packageAccess.locked ? `需要 ${packageAccess.cost} 點；開通後 ${packageAccess.days} 天內不限次數重做。` : packageRemaining !== null ? `剩餘 ${formatRemaining(packageRemaining)}；請把握時間完成練習。` : `${packageAccess.days} 天內不限次數重做。`}</span>
        </div>
        {packageAccess.locked && <button type="button" onClick={() => setPaywallOpen(true)}>前往解鎖</button>}
      </section>}
      <div className="medtech-exam-grid">
        <aside className="medtech-question-map">
          <header>
            <b>{wrongOnly ? "錯題題號" : "題號"}</b>
            <span>
              {answered}／{rows.length} 已作答
            </span>
          </header>
          <div>
            {rows.map((item, i) => (
              <button
                key={item.id}
                className={(i === index ? "active " : "") + (answers[item.id] ? "answered " : "") + (flagged.includes(item.id) ? "flagged" : "")}
                onClick={() => setIndex(i)}
              >
                {i + 1}
              </button>
            ))}
          </div>
          <small>{wrongOnly ? "答對或標記「我學會了」後移除" : packageAccess?.locked ? "題目完整列出；鎖定題目可點擊查看解鎖方式" : "實心＝已作答 · 圓點＝待確認"}</small>
        </aside>
        <section className="medtech-question">
          <header>
            <span>第 {index + 1} 題 {q.locked ? "· 尚未解鎖" : ""}</span>
            <div className="medtech-question-actions">
              {wrongOnly && (
                <button className="mastered" onClick={() => void markMastered()} disabled={mastering} aria-busy={mastering}>
                  {mastering ? <span className="medtech-loading-label"><i className="medtech-loading-spinner" aria-hidden="true"/>處理中…</span> : "✓ 我學會了"}
                </button>
              )}
              <button
                onClick={() =>
                  setFlagged((value) =>
                    value.includes(q.id) ? value.filter((id) => id !== q.id) : [...value, q.id],
                  )
                }
              >
                {flagged.includes(q.id) ? "取消標記" : "標記待確認"}
              </button>
            </div>
          </header>
          <h2>{q.stem}</h2>
          <div className="medtech-options">
            {letters.map((letter) => (
              <button
                className={answers[q.id] === letter ? "selected" : ""}
                key={letter}
                onClick={() => q.locked ? setPaywallOpen(true) : setAnswers({ ...answers, [q.id]: letter })}
              >
                <b>{letter}</b>
                <span>{q.options[letter]}</span>
              </button>
            ))}
          </div>
          <footer>
            <button disabled={index === 0} onClick={() => setIndex(index - 1)}>
              上一題
            </button>
            <span>{q.locked ? `本題屬於題目包；需要 ${packageAccess?.cost ?? 30} 點解鎖` : "答案在完成前不顯示"}</span>
            <button disabled={index === rows.length - 1} onClick={() => setIndex(index + 1)}>
              下一題
            </button>
          </footer>
        </section>
      </div>
      {paywallOpen && <div className="medtech-paywall-backdrop" role="presentation" onMouseDown={() => setPaywallOpen(false)}><section className="medtech-paywall" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}><span>醫檢師題目包</span><h2>先體驗，再決定是否購買</h2><p>這 30 題已完整列出。首次體驗可免費作答；目前這一包需要 {packageAccess?.cost ?? 30} 點解鎖，開通後 7 天內不限次數重做，並會保存完成時間、答題時間、錯題與需要加強的觀念。</p><div><button type="button" onClick={() => setPaywallOpen(false)}>稍後再說</button><Link href="/medtech/upgrade?reason=question-pack">前往購買點數</Link></div></section></div>}
    </main>
  );
}
