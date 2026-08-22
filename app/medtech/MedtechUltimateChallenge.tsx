"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import LinePayPurchaseButton from "./LinePayPurchaseButton";

type Props = {
  packageName: string;
  packNumber: number;
  targets?: Array<{ packageName: string; packNumber: number; questionTotal: number }>;
  dailyStatus?: "available" | "in_progress" | "finished";
  rescueDue?: boolean;
};
type Question = { id: number; stem: string; options: Record<string, string> };
type Reward = { status?: string; label?: string | null; cost?: number };
type WrongAnswer = {
  questionNumber: number;
  stem: string;
  selectedAnswer: string;
  selectedText: string;
  correctAnswer: string;
  correctText: string;
  explanation: string;
  reason: string;
};
type RescueReview = {
  questionNumber: number;
  correct: boolean;
  selectedAnswer: string;
  selectedText: string;
  correctAnswer: string;
  correctText: string;
  explanation: string;
  reason: string;
};
type Result = {
  score: number;
  total: number;
  durationSeconds: number;
  passed: boolean;
  reward?: Reward;
  wrongAnswer?: WrongAnswer;
};
const TOTAL_TIME_LIMIT_SECONDS = 180;
const QUESTION_TIME_LIMIT_SECONDS = 5;
const RESCUE_TIME_LIMIT_SECONDS = 10;

export default function MedtechUltimateChallenge({
  packageName,
  packNumber,
  targets = [],
  dailyStatus = "available",
  rescueDue = false,
}: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingMode, setLoadingMode] = useState<"challenge" | "rescue" | "result" | null>(null);
  const [busy, setBusy] = useState(false);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const answersRef = useRef<Record<number, string>>({});
  const actionStartedRef = useRef(false);
  const questionStartedAtRef = useRef(0);
  const [startedAt, setStartedAt] = useState("");
  const [secondsLeft, setSecondsLeft] = useState(TOTAL_TIME_LIMIT_SECONDS);
  const [questionSecondsLeft, setQuestionSecondsLeft] = useState(
    QUESTION_TIME_LIMIT_SECONDS,
  );
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState("");
  const [selectedAnswer, setSelectedAnswer] = useState("");
  const [answerFeedback, setAnswerFeedback] = useState("");
  const [selectedTarget, setSelectedTarget] = useState(() =>
    targets.find((target) => target.packageName === packageName && target.packNumber === packNumber) ?? targets[0] ?? { packageName, packNumber, questionTotal: 30 },
  );
  const [rescueQuestions, setRescueQuestions] = useState<Question[]>([]);
  const [rescueIndex, setRescueIndex] = useState(0);
  const [rescueMessage, setRescueMessage] = useState("");
  const [selectedRescueAnswer, setSelectedRescueAnswer] = useState("");
  const [rescueSecondsLeft, setRescueSecondsLeft] = useState(RESCUE_TIME_LIMIT_SECONDS);
  const [rescueTimerRound, setRescueTimerRound] = useState(0);
  const [rescueFailed, setRescueFailed] = useState(false);
  const [rescueReview, setRescueReview] = useState<RescueReview | null>(null);
  const [rescueNext, setRescueNext] = useState<{ index: number; completed: boolean; passed: boolean; score: number } | null>(null);

  function close() {
    if (!loading && !busy && (!questions.length || result)) setOpen(false);
  }

  function openChallenge() {
    setOpen(true);
    setError("");
    if (rescueDue) void startRescue();
    else if (dailyStatus !== "available") void startChallenge();
  }

  async function startChallenge() {
    setLoading(true);
    setLoadingMode(dailyStatus === "finished" ? "result" : "challenge");
    setError("");
    setResult(null);
    setQuestions([]);
    setAnswers({});
    setSelectedAnswer("");
    setAnswerFeedback("");
    answersRef.current = {};
    questionStartedAtRef.current = 0;
    setIndex(0);
    try {
      const response = await fetch(
        `/api/medtech/question-pack-reward?challenge=ultimate&packageName=${encodeURIComponent(selectedTarget.packageName)}&pack=${selectedTarget.packNumber}`,
        { cache: "no-store" },
      );
      const data = (await response.json()) as {
        questions?: Question[];
        startedAt?: string;
        lastActiveAt?: string;
        status?: string;
        result?: Result | null;
        packageName?: string;
        packageNumber?: number;
        error?: string;
      };
      if (!response.ok)
        throw new Error(data.error || "終極挑戰暫時無法使用，請稍後再試。");
      if (data.packageName && data.packageNumber) {
        const restored = targets.find((target) => target.packageName === data.packageName && target.packNumber === data.packageNumber);
        setSelectedTarget(restored ?? { packageName: data.packageName, packNumber: data.packageNumber, questionTotal: 30 });
      }
      if (data.result) setResult(data.result);
      if (data.status === "in_progress" && data.questions?.length) {
        const readyResponse = await fetch("/api/medtech/question-pack-reward", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "ultimate-ready" }),
        });
        const ready = (await readyResponse.json()) as { startedAt?: string; lastActiveAt?: string; error?: string };
        if (!readyResponse.ok) throw new Error(ready.error || "挑戰計時器啟動失敗。");
        setQuestions(data.questions);
        setStartedAt(ready.startedAt || data.startedAt || new Date().toISOString());
        setIndex(
          Math.max(
            0,
            Math.min(
              (data.questions.length || 1) - 1,
              Math.floor(
                Number((data as { currentIndex?: unknown }).currentIndex) || 0,
              ),
            ),
          ),
        );
        questionStartedAtRef.current = ready.lastActiveAt
          ? new Date(ready.lastActiveAt).getTime()
          : Date.now();
        setSecondsLeft(TOTAL_TIME_LIMIT_SECONDS);
        setQuestionSecondsLeft(QUESTION_TIME_LIMIT_SECONDS);
      } else if (data.status !== "in_progress" && !data.result) {
        throw new Error("今天的終極挑戰已經結束。");
      }
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "終極挑戰暫時無法使用，請稍後再試。",
      );
    } finally {
      setLoading(false);
      setLoadingMode(null);
    }
  }

  async function startRescue() {
    setLoading(true);
    setLoadingMode("rescue");
    setError("");
    setRescueMessage("");
    try {
      const response = await fetch("/api/medtech/question-pack-reward?challenge=ultimate-rescue", { cache: "no-store" });
      const data = (await response.json()) as { questions?: Question[]; currentIndex?: number; completed?: boolean; failed?: boolean; score?: number; error?: string };
      if (!response.ok) throw new Error(data.error || "補救任務暫時無法使用。");
      if (data.completed) {
        setRescueMessage("補救已通過，明日取得一次正式挑戰資格。");
      } else if (data.failed) {
        setRescueFailed(true);
        setRescueMessage("已完成 10 題，其中答對 " + (data.score ?? 0) + " 題；通過門檻為 8 題，明天可重新挑戰。");
      } else {
        setRescueFailed(false);
        setRescueQuestions(data.questions ?? []);
        setRescueIndex(data.currentIndex ?? 0);
        setRescueSecondsLeft(RESCUE_TIME_LIMIT_SECONDS);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "補救任務暫時無法使用。");
    } finally {
      setLoading(false);
      setLoadingMode(null);
    }
  }

  async function answerRescue(answer: string) {
    const question = rescueQuestions[rescueIndex];
    if (!question || busy) return;
    setSelectedRescueAnswer(answer);
    setRescueMessage("答案送出中…");
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/medtech/question-pack-reward", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "ultimate-rescue-answer", questionId: question.id, answer }),
      });
      const data = (await response.json()) as { correct?: boolean; currentIndex?: number; completed?: boolean; passed?: boolean; score?: number; review?: RescueReview; message?: string; error?: string };
      if (!response.ok) throw new Error(data.error || "補救作答送出失敗。");
      setRescueMessage(data.message || (data.correct ? "答對了。" : "這題答錯了，請查看解析。"));
      setRescueReview(data.review ?? null);
      setRescueNext({
        index: data.currentIndex ?? rescueIndex + 1,
        completed: Boolean(data.completed),
        passed: Boolean(data.passed),
        score: data.score ?? 0,
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "補救作答送出失敗。");
    } finally {
      setBusy(false);
    }
  }

  function continueRescue() {
    if (!rescueNext) return;
    if (rescueNext.completed) {
      setRescueQuestions([]);
      setRescueFailed(!rescueNext.passed);
      setRescueMessage(
        rescueNext.passed
          ? "已完成 10 題，其中答對 " + rescueNext.score + " 題，補救通過；明日取得一次正式挑戰資格。"
          : "已完成 10 題，其中答對 " + rescueNext.score + " 題；通過門檻為 8 題，本次補救未通過，明天可重新挑戰。",
      );
      router.refresh();
    } else {
      setRescueIndex(rescueNext.index);
      setRescueMessage("");
      setSelectedRescueAnswer("");
      setRescueSecondsLeft(RESCUE_TIME_LIMIT_SECONDS);
      setRescueTimerRound((round) => round + 1);
    }
    setRescueReview(null);
    setRescueNext(null);
  }

  async function sendAnswer(
    answer: string | null,
    reason: "answer" | "timeout" | "abandoned",
  ) {
    const question = questions[index];
    if (busy || actionStartedRef.current || result || !questions.length) return;
    actionStartedRef.current = true;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/medtech/question-pack-reward", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          packageName: selectedTarget.packageName,
          pack: selectedTarget.packNumber,
          action:
            reason === "abandoned" ? "ultimate-abandon" : "ultimate-answer",
          questionId: question?.id,
          answer,
          reason,
        }),
      });
      const data = (await response.json()) as {
        correct?: boolean;
        status?: string;
        nextIndex?: number;
        score?: number;
        total?: number;
        durationSeconds?: number;
        passed?: boolean;
        reward?: Reward;
        wrongAnswer?: WrongAnswer;
        error?: string;
      };
      if (!response.ok)
        throw new Error(data.error || "終極挑戰送出失敗，請稍後再試。");
      if (data.status === "completed" || data.status === "failed") {
        setResult({
          score: data.score ?? 0,
          total: data.total ?? questions.length,
          durationSeconds: data.durationSeconds ?? TOTAL_TIME_LIMIT_SECONDS,
          passed: Boolean(data.passed),
          reward: data.reward,
          wrongAnswer: data.wrongAnswer,
        });
        setQuestions([]);
      } else if (data.correct) {
        if (question && answer) {
          const next = { ...answersRef.current, [question.id]: answer };
          answersRef.current = next;
          setAnswers(next);
        }
        setIndex(data.nextIndex ?? index + 1);
        setSelectedAnswer("");
        setAnswerFeedback("");
        questionStartedAtRef.current = Date.now();
        setQuestionSecondsLeft(QUESTION_TIME_LIMIT_SECONDS);
      }
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "終極挑戰送出失敗，請稍後再試。",
      );
    } finally {
      actionStartedRef.current = false;
      setBusy(false);
    }
  }

  function chooseAnswer(answer: string) {
    const question = questions[index];
    if (
      !question ||
      busy ||
      result ||
      questionSecondsLeft <= 0 ||
      secondsLeft <= 0
    )
      return;
    setSelectedAnswer(answer);
    setAnswerFeedback("答案送出中…");
    void sendAnswer(answer, "answer");
  }

  function abandonChallenge() {
    void sendAnswer(null, "abandoned");
  }

  useEffect(() => {
    if (!open || loading || !startedAt || result || !questions.length) return;
    const tick = () => {
      const elapsed = Math.floor(
        (Date.now() - new Date(startedAt).getTime()) / 1000,
      );
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
    if (!questionStartedAtRef.current)
      questionStartedAtRef.current = Date.now();
    setQuestionSecondsLeft(QUESTION_TIME_LIMIT_SECONDS);
    const timer = window.setInterval(() => {
      const elapsed = Math.floor(
        (Date.now() - questionStartedAtRef.current) / 1000,
      );
      const remaining = Math.max(0, QUESTION_TIME_LIMIT_SECONDS - elapsed);
      setQuestionSecondsLeft(remaining);
      if (!remaining) {
        window.clearInterval(timer);
        void sendAnswer(null, "timeout");
      }
    }, 100);
    return () => window.clearInterval(timer);
  }, [open, loading, result, busy, index, questions]);

  useEffect(() => {
    if (!open || loading || busy || rescueReview || !rescueQuestions[rescueIndex]) return;
    const deadline = Date.now() + RESCUE_TIME_LIMIT_SECONDS * 1000;
    setRescueSecondsLeft(RESCUE_TIME_LIMIT_SECONDS);
    const timer = window.setInterval(() => {
      const remaining = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      setRescueSecondsLeft(remaining);
      if (!remaining) {
        window.clearInterval(timer);
        setSelectedRescueAnswer("");
        setRescueMessage("本題時間到，正在結束本次補救…");
        void answerRescue("");
      }
    }, 100);
    return () => window.clearInterval(timer);
  }, [open, loading, busy, rescueIndex, rescueQuestions, rescueTimerRound, rescueReview]);

  const question = questions[index];
  return (
    <>
      <div className="medtech-ultimate-banner">
        <div>
          <span className="medtech-ultimate-kicker">
            DAILY MASTER CHALLENGE
          </span>
          <strong>🏆 1 折終極挑戰</strong>
          <p>
            完成過任一題包即可取得 1 次資格；任選尚未購買的題包，挑戰隨機 30
            題。每題 5 秒、總限時 3 分鐘，全部答對即可用 LINE Pay NT$3 購買。
          </p>
        </div>
        <button
          type="button"
          onClick={openChallenge}
          disabled={loading || busy}
        >
          {dailyStatus === "finished"
            ? "查看結果／補救任務 →"
            : rescueDue
              ? "開始 10 題補救任務 →"
            : dailyStatus === "in_progress"
              ? "繼續今日挑戰 →"
              : "開始挑戰 →"}
        </button>
      </div>
      {open && typeof document !== "undefined" && createPortal((
        <div
          className="medtech-spin-backdrop"
          role="presentation"
          onMouseDown={close}
        >
          <section
            className="medtech-ultimate-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="medtech-ultimate-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              className="medtech-spin-close"
              onClick={close}
              disabled={loading || busy || Boolean(questions.length && !result)}
              aria-label="關閉"
            >
              ×
            </button>
            <span className="medtech-spin-kicker">DAILY MASTER CHALLENGE</span>
            <h2 id="medtech-ultimate-title">🏆 1 折終極挑戰</h2>
            <p className="medtech-ultimate-intro">
              先選定一個尚未購買的題包；隨機 30 題、選項重新打亂。每題限時 5 秒，總限時 3
              分鐘，答錯、逾時或放棄都會結束今天的挑戰。完成後才顯示結果，不會在作答中透露答案。
            </p>
            {(rescueQuestions[rescueIndex] || rescueFailed) && (
              <div className="medtech-rescue-rule">
                <strong>補救任務規則</strong>
                <span>共 10 題，每題 10 秒且只能作答一次；答對 8 題以上即通過。每題作答後會顯示正確答案與解析，通過後於明日取得一次正式挑戰資格。</span>
              </div>
            )}
            {loading ? (
              <div className="medtech-challenge-loading">
                <span className="medtech-loading-spinner" />
                {loadingMode === "rescue"
                  ? "10 題補救複習準備中…"
                  : loadingMode === "result"
                    ? "正在讀取今天的挑戰結果…"
                  : "30 題正式挑戰準備中，載入完成才開始計時…"}
              </div>
            ) : rescueQuestions[rescueIndex] ? (
              <div className="medtech-ultimate-question">
                <div className="medtech-ultimate-meta"><small>補救複習第 {rescueIndex + 1}／10 題 · 通過門檻 8／10</small><strong className={rescueSecondsLeft <= 3 ? "urgent" : ""}>{rescueReview ? "本題已完成" : "本題剩 " + rescueSecondsLeft + " 秒"}</strong></div>
                <h3>{rescueQuestions[rescueIndex].stem}</h3>
                <div className="medtech-challenge-options">
                  {["A", "B", "C", "D"].map((letter) => <button type="button" key={letter} disabled={busy || Boolean(rescueReview)} className={selectedRescueAnswer === letter ? "selected" : ""} onClick={() => void answerRescue(letter)}><b>{letter}</b><span>{rescueQuestions[rescueIndex].options[letter] || ""}</span></button>)}
                </div>
                {rescueMessage && <p className="medtech-ultimate-answer-feedback" role="status">{rescueMessage}</p>}
                {rescueReview && (
                  <div className={"medtech-rescue-review " + (rescueReview.correct ? "correct" : "incorrect")}>
                    <strong>{rescueReview.correct ? "答對了" : "這題需要複習"}</strong>
                    <p>你的答案：{rescueReview.selectedAnswer}{rescueReview.selectedText ? "　" + rescueReview.selectedText : ""}</p>
                    <p>正確答案：{rescueReview.correctAnswer}{rescueReview.correctText ? "　" + rescueReview.correctText : ""}</p>
                    <p>說明：{rescueReview.reason}</p>
                    <p>解析：{rescueReview.explanation}</p>
                    <button type="button" className="medtech-discount-unlock-button" onClick={continueRescue}>{rescueNext?.completed ? "查看補救結果 →" : "下一題 →"}</button>
                  </div>
                )}
              </div>
            ) : rescueFailed ? (
              <div className="medtech-ultimate-result failed">
                <strong>本次補救未通過</strong>
                <span>{rescueMessage || "已完成 10 題；通過門檻為答對至少 8 題。明天可重新挑戰一組新的 10 題。"}</span>
              </div>
            ) : result ? (
              <div
                className={`medtech-ultimate-result${result.passed ? " passed" : " failed"}`}
              >
                <strong>
                  {result.passed ? "挑戰成功！30／30 全對" : "這次沒有通過"}
                </strong>
                <span>
                  答對 {result.score}／{result.total} 題 · 用時{" "}
                  {result.durationSeconds} 秒
                  {result.passed
                    ? " · 一折優惠保留至今日 23:59"
                    : " · 完成 10 題補救，可取得明日一次挑戰資格"}
                </span>
                {!result.passed && result.wrongAnswer && (
                  <div className="medtech-ultimate-wrong-detail">
                    <strong>第 {result.wrongAnswer.questionNumber} 題未答對</strong>
                    <p>{result.wrongAnswer.stem}</p>
                    <dl>
                      <div><dt>你的答案</dt><dd>{result.wrongAnswer.selectedAnswer}{result.wrongAnswer.selectedText ? `　${result.wrongAnswer.selectedText}` : ""}</dd></div>
                      <div><dt>正確答案</dt><dd>{result.wrongAnswer.correctAnswer}{result.wrongAnswer.correctText ? `　${result.wrongAnswer.correctText}` : ""}</dd></div>
                      <div><dt>答錯原因</dt><dd>{result.wrongAnswer.reason}</dd></div>
                      <div><dt>老師／原稿解析</dt><dd>{result.wrongAnswer.explanation}</dd></div>
                    </dl>
                  </div>
                )}
                {result.passed && (
                  <LinePayPurchaseButton packageName={selectedTarget.packageName} packNumber={selectedTarget.packNumber} amount={3} />
                )}
                {!result.passed && !rescueMessage && <button type="button" className="medtech-discount-unlock-button" onClick={() => void startRescue()}>開始 10 題補救複習 →</button>}
                {rescueMessage && <p>{rescueMessage}</p>}
              </div>
            ) : question ? (
              <div className="medtech-ultimate-question">
                <div className="medtech-ultimate-meta">
                  <small>
                    第 {index + 1}／{questions.length} 題 · 本題剩{" "}
                    {questionSecondsLeft} 秒
                  </small>
                  <strong className={secondsLeft <= 30 ? "urgent" : ""}>
                    總計 {Math.floor(secondsLeft / 60)}:
                    {String(secondsLeft % 60).padStart(2, "0")}
                  </strong>
                </div>
                <h3>{question.stem}</h3>
                <div className="medtech-challenge-options">
                  {["A", "B", "C", "D"].map((letter) => (
                    <button
                      type="button"
                      key={letter}
                      disabled={busy}
                      className={
                        selectedAnswer === letter || answers[question.id] === letter ? "selected" : ""
                      }
                      onClick={() => chooseAnswer(letter)}
                    >
                      <b>{letter}</b>
                      <span>{question.options[letter] || ""}</span>
                    </button>
                  ))}
                </div>
                {answerFeedback && <p className="medtech-ultimate-answer-feedback" role="status">{answerFeedback}</p>}
                <button
                  type="button"
                  className="medtech-challenge-abandon"
                  onClick={abandonChallenge}
                  disabled={busy}
                >
                  放棄挑戰
                </button>
              </div>
            ) : dailyStatus === "available" && targets.length ? (
              <div className="medtech-ultimate-targets">
                <strong>選擇要取得一折優惠的題目包</strong>
                <div>
                  {targets.map((target) => (
                    <button type="button" key={`${target.packageName}-${target.packNumber}`} className={selectedTarget.packageName === target.packageName && selectedTarget.packNumber === target.packNumber ? "selected" : ""} onClick={() => setSelectedTarget(target)}>
                      {target.packageName}・第 {target.packNumber} 關（{target.questionTotal} 題）
                    </button>
                  ))}
                </div>
                <button type="button" className="medtech-discount-unlock-button" onClick={() => void startChallenge()}>我要挑戰這一包 →</button>
              </div>
            ) : (
              <div className="medtech-challenge-error">
                {error || "今天的挑戰尚未準備好。"}
              </div>
            )}
            {error && <em className="medtech-spin-error">{error}</em>}
          </section>
        </div>
      ), document.body)}
    </>
  );
}
