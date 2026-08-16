"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import MedtechTabs from "../MedtechTabs";

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
  hasFullExplanation?: boolean;
  fullExplanation?: string;
};

type ApiResult = {
  items?: Question[];
  error?: string;
  message?: string;
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
  const [fullNotice, setFullNotice] = useState("");
  const [route, setRoute] = useState({ ready: false, topic: "", wrongOnly: false });

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setRoute({
      ready: true,
      topic: params.get("topic") || "",
      wrongOnly: params.get("wrongOnly") === "1",
    });
  }, []);

  const { topic, wrongOnly } = route;

  useEffect(() => {
    if (!route.ready) return;
    setLoading(true);
    setError("");
    setRows([]);
    const query = new URLSearchParams({ limit: "30", mode: "practice" });
    if (topic) query.set("topic", topic);
    if (wrongOnly) query.set("wrongOnly", "1");
    fetch("/api/medtech/questions?" + query.toString())
      .then(async (response) => {
        const result = await readJson(response);
        if (!response.ok) throw new Error(result.error || "題庫讀取失敗");
        setRows(result.items ?? []);
        if (!result.items?.length) setError(result.message || "目前沒有符合條件的醫檢師題目。");
      })
      .catch((reason) => setError(reason instanceof Error ? reason.message : "題庫讀取失敗"))
      .finally(() => setLoading(false));
  }, [route.ready, topic, wrongOnly]);

  const q = rows[index];
  const score = useMemo(() => rows.filter((item) => answers[item.id] === item.answer).length, [answers, rows]);
  const answered = Object.keys(answers).length;

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
      </header>
      <MedtechTabs active={wrongOnly ? "wrong" : "random"} />
    </>
  );

  async function submitExam() {
    setSubmitted(true);
    setIndex(0);
    setFullNotice("");
    const payload = Object.entries(answers).map(([questionId, answer]) => ({
      questionId: Number(questionId),
      answer,
    }));
    if (payload.length) {
      await fetch("/api/medtech/questions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ answers: payload }),
      }).catch(() => undefined);
    }
    const ids = rows.map((item) => item.id).join(",");
    if (!ids) return;
    try {
      const response = await fetch("/api/medtech/questions?mode=review&ids=" + ids, { cache: "no-store" });
      const result = await readJson(response);
      if (!response.ok) return;
      setRows((current) =>
        current.map((item) => {
          const detail = result.items?.find((next) => next.id === item.id);
          return detail ? { ...item, ...detail } : item;
        }),
      );
    } catch {
      // The review screen can still show the question and answer without explanation text.
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
        setFullNotice(result.error || "點數已用完；完整解析每題扣 1 點，請先購買點數。");
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
    if (!wrongOnly || !q) return;
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
  }

  useEffect(() => {
    if (submitted) void submitExam();
  }, [submitted]);

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
            <p>答對率 {Math.round((score / rows.length) * 100)}% · 已作答 {answered} 題</p>
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
                  {unlockingId === q.id ? "開啟中…" : "查看完整解析（扣 1 點）"}
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
          <span>{wrongOnly ? "個人錯題庫 · " + rows.length + " 題待複習" : "正式題庫 · 隨機 30 題"}</span>
          <h1>{wrongOnly ? "錯題複習" : "臨床病毒學（下）"}</h1>
          <p>
            第 {index + 1}／{rows.length} 題 · {q.year} 年專技
          </p>
        </div>
        <button onClick={() => setSubmitted(true)}>{wrongOnly ? "完成複習" : "交卷"}</button>
      </section>
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
          <small>{wrongOnly ? "答對或標記「我學會了」後移除" : "實心＝已作答 · 圓點＝待確認"}</small>
        </aside>
        <section className="medtech-question">
          <header>
            <span>第 {index + 1} 題</span>
            <div className="medtech-question-actions">
              {wrongOnly && (
                <button className="mastered" onClick={() => void markMastered()}>
                  ✓ 我學會了
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
                onClick={() => setAnswers({ ...answers, [q.id]: letter })}
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
            <span>答案在完成前不顯示</span>
            <button disabled={index === rows.length - 1} onClick={() => setIndex(index + 1)}>
              下一題
            </button>
          </footer>
        </section>
      </div>
    </main>
  );
}
