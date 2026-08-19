"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

type Props = { packageName: string; packNumber: number; href: string; dailyStatus?: "available" | "in_progress" | "finished" };
type Question = { id: number; stem: string; options: Record<string, string> };
type Reward = { status?: string; label?: string | null; cost?: number };
type Result = { score: number; total: number; durationSeconds: number; passed: boolean; reward?: Reward };
const TOTAL_TIME_LIMIT_SECONDS = 180;
const QUESTION_TIME_LIMIT_SECONDS = 5;

export default function MedtechUltimateChallenge({ packageName, packNumber, href, dailyStatus = "available" }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [unlocking, setUnlocking] = useState(false);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const answersRef = useRef<Record<number, string>>({});
  const actionStartedRef = useRef(false);
  const questionStartedAtRef = useRef(0);
  const [startedAt, setStartedAt] = useState("");
  const [secondsLeft, setSecondsLeft] = useState(TOTAL_TIME_LIMIT_SECONDS);
  const [questionSecondsLeft, setQuestionSecondsLeft] = useState(QUESTION_TIME_LIMIT_SECONDS);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState("");

  function close() {
    if (!loading && !busy && (!questions.length || result)) setOpen(false);
  }

  async function openChallenge() {
    setOpen(true);
    setLoading(true);
    setError("");
    setResult(null);
    setQuestions([]);
    setAnswers({});
    answersRef.current = {};
    questionStartedAtRef.current = 0;
    setIndex(0);
    try {
      const response = await fetch(`/api/medtech/question-pack-reward?challenge=ultimate&packageName=${encodeURIComponent(packageName)}&pack=${packNumber}`, { cache: "no-store" });
      const data = await response.json() as { questions?: Question[]; startedAt?: string; lastActiveAt?: string; status?: string; result?: Result | null; error?: string };
      if (!response.ok) throw new Error(data.error || "終極挑戰暫時無法使用，請稍後再試。");
      if (data.result) setResult(data.result);
      if (data.status === "in_progress" && data.questions?.length) {
        setQuestions(data.questions);
        setStartedAt(data.startedAt || new Date().toISOString());
        setIndex(Math.max(0, Math.min((data.questions.length || 1) - 1, Math.floor(Number((data as { currentIndex?: unknown }).currentIndex) || 0))));
        questionStartedAtRef.current = data.lastActiveAt ? new Date(data.lastActiveAt).getTime() : Date.now();
        setSecondsLeft(TOTAL_TIME_LIMIT_SECONDS);
        setQuestionSecondsLeft(QUESTION_TIME_LIMIT_SECONDS);
      } else if (data.status !== "in_progress" && !data.result) {
        throw new Error("今天的終極挑戰已經結束。");
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "終極挑戰暫時無法使用，請稍後再試。");
    } finally {
      setLoading(false);
    }
  }

  async function sendAnswer(answer: string | null, reason: "answer" | "timeout" | "abandoned") {
    const question = questions[index];
    if (busy || actionStartedRef.current || result || !questions.length) return;
    actionStartedRef.current = true;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/medtech/question-pack-reward", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ packageName, pack: packNumber, action: reason === "abandoned" ? "ultimate-abandon" : "ultimate-answer", questionId: question?.id, answer, reason }),
      });
      const data = await response.json() as { correct?: boolean; status?: string; nextIndex?: number; score?: number; total?: number; durationSeconds?: number; passed?: boolean; reward?: Reward; error?: string };
      if (!response.ok) throw new Error(data.error || "終極挑戰送出失敗，請稍後再試。");
      if (data.status === "completed" || data.status === "failed") {
        setResult({ score: data.score ?? 0, total: data.total ?? questions.length, durationSeconds: data.durationSeconds ?? TOTAL_TIME_LIMIT_SECONDS, passed: Boolean(data.passed), reward: data.reward });
        setQuestions([]);
      } else if (data.correct) {
        if (question && answer) {
          const next = { ...answersRef.current, [question.id]: answer };
          answersRef.current = next;
          setAnswers(next);
        }
        setIndex(data.nextIndex ?? index + 1);
        questionStartedAtRef.current = Date.now();
        setQuestionSecondsLeft(QUESTION_TIME_LIMIT_SECONDS);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "終極挑戰送出失敗，請稍後再試。");
    } finally {
      actionStartedRef.current = false;
      setBusy(false);
    }
  }

  function chooseAnswer(answer: string) {
    const question = questions[index];
    if (!question || busy || result || questionSecondsLeft <= 0 || secondsLeft <= 0) return;
    void sendAnswer(answer, "answer");
  }

  function abandonChallenge() {
    void sendAnswer(null, "abandoned");
  }

  useEffect(() => {
    if (!open || loading || !startedAt || result || !questions.length) return;
    const tick = () => {
      const elapsed = Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000);
      const remaining = Math.max(0, TOTAL_TIME_LIMIT_SECONDS - elapsed);
      setSecondsLeft(remaining);
      if (!remaining) void sendAnswer(null, "timeout");
    };
    tick();
    const timer = window.setInterval(tick, 250);
    return () => window.clearInterval(timer);
  }, [open, loading, startedAt, result, questions.length, index]);

  useEffect(() => {
    const question = questions[index];
    if (!open || loading || result || busy || !question) return;
    if (!questionStartedAtRef.current) questionStartedAtRef.current = Date.now();
    setQuestionSecondsLeft(QUESTION_TIME_LIMIT_SECONDS);
    const timer = window.setInterval(() => {
      const elapsed = Math.floor((Date.now() - questionStartedAtRef.current) / 1000);
      const remaining = Math.max(0, QUESTION_TIME_LIMIT_SECONDS - elapsed);
      setQuestionSecondsLeft(remaining);
      if (!remaining) {
        window.clearInterval(timer);
        void sendAnswer(null, "timeout");
      }
    }, 100);
    return () => window.clearInterval(timer);
  }, [open, loading, result, busy, index, questions]);

  async function unlock() {
    if (unlocking || !result?.passed) return;
    setUnlocking(true);
    setError("");
    try {
      const query = new URLSearchParams({ limit: "30", mode: "practice", pack: String(packNumber), unlock: "1", questionOrder: "ordered", optionOrder: "ordered", topic: packageName });
      const response = await fetch(`/api/medtech/questions?${query.toString()}`, { cache: "no-store" });
      const data = await response.json() as { packageAccess?: { locked?: boolean; blockedByPrevious?: boolean }; error?: string };
      if (!response.ok || data.packageAccess?.locked || data.packageAccess?.blockedByPrevious) throw new Error(data.error || "解鎖失敗，請稍後再試。");
      window.dispatchEvent(new Event("medtech-points-updated"));
      setOpen(false);
      router.push(href);
      router.refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "解鎖失敗，請稍後再試。");
    } finally {
      setUnlocking(false);
    }
  }

  const question = questions[index];
  return <>
    <div className="medtech-ultimate-banner">
      <div><span className="medtech-ultimate-kicker">DAILY MASTER CHALLENGE</span><strong>🏆 1 折終極挑戰</strong><p>每日限 1 次；從上一關隨機抽 30 題，題號與選項都重新打亂。每題 5 秒、總限時 3 分鐘，30 題全對，下一關只要 3 點解鎖。</p></div>
      <button type="button" onClick={() => void openChallenge()} disabled={loading || busy || dailyStatus === "finished"}>{dailyStatus === "finished" ? "今日已挑戰，明天再來" : dailyStatus === "in_progress" ? "繼續今日挑戰 →" : "開始挑戰 →"}</button>
    </div>
    {open && <div className="medtech-spin-backdrop" role="presentation" onMouseDown={close}>
      <section className="medtech-ultimate-dialog" role="dialog" aria-modal="true" aria-labelledby="medtech-ultimate-title" onMouseDown={(event) => event.stopPropagation()}>
        <button type="button" className="medtech-spin-close" onClick={close} disabled={loading || busy || Boolean(questions.length && !result)} aria-label="關閉">×</button>
        <span className="medtech-spin-kicker">DAILY MASTER CHALLENGE</span>
        <h2 id="medtech-ultimate-title">🏆 1 折終極挑戰</h2>
        <p className="medtech-ultimate-intro">每日限 1 次；隨機 30 題、選項重新打亂。每題限時 5 秒，總限時 3 分鐘，答錯、逾時或放棄都會結束今天的挑戰。完成後才顯示結果，不會在作答中透露答案。</p>
        {loading ? <div className="medtech-challenge-loading"><span className="medtech-loading-spinner" /> 30 題準備中，載入完成才開始計時…</div> : result ? <div className={`medtech-ultimate-result${result.passed ? " passed" : " failed"}`}><strong>{result.passed ? "挑戰成功！30／30 全對" : "這次沒有通過"}</strong><span>答對 {result.score}／{result.total} 題 · 用時 {result.durationSeconds} 秒{result.passed ? " · 今日 1 折資格已取得" : " · 今日機會已用完，明天再來"}</span>{result.passed && <button type="button" className="medtech-discount-unlock-button" onClick={() => void unlock()} disabled={unlocking}>{unlocking ? "解鎖中…" : "用 3 點解鎖並開始練習 →"}</button>}</div> : question ? <div className="medtech-ultimate-question"><div className="medtech-ultimate-meta"><small>第 {index + 1}／{questions.length} 題 · 本題剩 {questionSecondsLeft} 秒</small><strong className={secondsLeft <= 30 ? "urgent" : ""}>總計 {Math.floor(secondsLeft / 60)}:{String(secondsLeft % 60).padStart(2, "0")}</strong></div><h3>{question.stem}</h3><div className="medtech-challenge-options">{["A", "B", "C", "D"].map((letter) => <button type="button" key={letter} disabled={busy} className={answers[question.id] === letter ? "selected" : ""} onClick={() => chooseAnswer(letter)}><b>{letter}</b><span>{question.options[letter] || ""}</span></button>)}</div><button type="button" className="medtech-challenge-abandon" onClick={abandonChallenge} disabled={busy}>放棄挑戰</button></div> : <div className="medtech-challenge-error">{error || "今天的挑戰尚未準備好。"}</div>}
        {error && <em className="medtech-spin-error">{error}</em>}
      </section>
    </div>}
  </>;
}
