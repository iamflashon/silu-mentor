"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type CSSProperties } from "react";

type Props = {
  packageName: string;
  packNumber: number;
  questionTotal: number;
  label: string;
  href: string;
};
type Reward = {
  status?: "available" | "revealed" | "abandoned" | "used";
  label?: string | null;
  cost?: number;
  percent?: number | null;
  retryAt?: string | null;
  quizAttemptsUsed?: number;
  quizAttemptsRemaining?: number;
};
type ChallengeQuestion = {
  id: number;
  stem: string;
  options: Record<string, string>;
};
type ChallengeResult = {
  score: number;
  total: number;
  averageSeconds: number;
  reward: Reward;
  attemptsRemaining: number;
};

const wheelAngles: Record<string, number> = {
  五折: 0,
  七五折: 90,
  九折: 180,
  原價: 270,
};

function remainingRetryText(retryAt: string | null | undefined, now: number) {
  if (!retryAt) return "";
  const minutes = Math.max(
    0,
    Math.ceil((new Date(retryAt).getTime() - now) / 60000),
  );
  if (!minutes) return "現在可以再抽一次";
  const hours = Math.floor(minutes / 60);
  return hours > 0 ? `約 ${hours} 小時後可再抽` : `約 ${minutes} 分鐘後可再抽`;
}

export default function MedtechPackDiscount({
  packageName,
  packNumber,
  questionTotal,
  label,
  href,
}: Props) {
  const router = useRouter();
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [unlocking, setUnlocking] = useState(false);
  const [reward, setReward] = useState<Reward | null>(null);
  const [used, setUsed] = useState(false);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);
  const [spinning, setSpinning] = useState(false);
  const [wheelRotation, setWheelRotation] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [challengeOpen, setChallengeOpen] = useState(false);
  const [challengeLoading, setChallengeLoading] = useState(false);
  const [challengeBusy, setChallengeBusy] = useState(false);
  const [challengeQuestions, setChallengeQuestions] = useState<
    ChallengeQuestion[]
  >([]);
  const [challengeIndex, setChallengeIndex] = useState(0);
  const [challengeAnswers, setChallengeAnswers] = useState<
    Record<number, string>
  >({});
  const challengeAnswersRef = useRef<Record<number, string>>({});
  const challengeTimingsRef = useRef<Record<number, number>>({});
  const challengeStartedAtRef = useRef(0);
  const [challengeSecondsLeft, setChallengeSecondsLeft] = useState(5);
  const [challengeResult, setChallengeResult] =
    useState<ChallengeResult | null>(null);
  const [challengeError, setChallengeError] = useState("");
  const [challengeAttemptsRemaining, setChallengeAttemptsRemaining] =
    useState(2);

  useEffect(() => {
    let mounted = true;
    void fetch(
      `/api/medtech/question-pack-reward?packageName=${encodeURIComponent(packageName)}&pack=${packNumber}`,
    )
      .then(async (response) => {
        if (!response.ok) return null;
        return (await response.json()) as { reward?: Reward };
      })
      .then((result) => {
        if (!mounted) return;
        setLoaded(true);
        const next = result?.reward;
        setChallengeAttemptsRemaining(next?.quizAttemptsRemaining ?? 2);
        if (next?.status === "used") setUsed(true);
        if (next && next.status !== "available" && next.status !== "used")
          setReward(next);
      })
      .catch(() => {
        if (mounted) setLoaded(true);
      });
    return () => {
      mounted = false;
    };
  }, [packageName, packNumber]);

  const retryAtMs = reward?.retryAt ? new Date(reward.retryAt).getTime() : 0;
  useEffect(() => {
    if (!retryAtMs) return;
    const tick = () => {
      const current = Date.now();
      setNow(current);
      if (current >= retryAtMs) {
        setReward(null);
        setOpen(false);
      }
    };
    tick();
    const timer = window.setInterval(tick, 30000);
    return () => window.clearInterval(timer);
  }, [retryAtMs]);

  function openWheel() {
    setError("");
    setOpen(true);
  }

  function closeWheel() {
    if (!busy) setOpen(false);
  }

  function closeChallenge() {
    if (
      !challengeBusy &&
      !challengeLoading &&
      (!challengeQuestions.length || challengeResult)
    )
      setChallengeOpen(false);
  }

  async function unlockInPlace() {
    if (unlocking || busy) return;
    setUnlocking(true);
    setError("");
    try {
      const query = new URLSearchParams({
        limit: String(questionTotal),
        mode: "practice",
        pack: String(packNumber),
        unlock: "1",
        questionOrder: "ordered",
        optionOrder: "ordered",
        topic: packageName,
      });
      const response = await fetch(
        `/api/medtech/questions?${query.toString()}`,
        { cache: "no-store" },
      );
      const result = (await response.json()) as {
        packageAccess?: { locked?: boolean; blockedByPrevious?: boolean };
        error?: string;
      };
      if (
        !response.ok ||
        result.packageAccess?.locked ||
        result.packageAccess?.blockedByPrevious
      ) {
        throw new Error(
          result.error ||
            (result.packageAccess?.blockedByPrevious
              ? "請先完成上一關，下一關才會開放。"
              : "付款尚未完成，請重新選購題目包。"),
        );
      }
      window.dispatchEvent(new Event("medtech-points-updated"));
      setOpen(false);
      setChallengeOpen(false);
      router.push(href);
      router.refresh();
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "題目包解鎖失敗，請稍後再試。 ",
      );
    } finally {
      setUnlocking(false);
    }
  }

  async function openChallenge() {
    setError("");
    setChallengeError("");
    setChallengeResult(null);
    setChallengeAnswers({});
    challengeAnswersRef.current = {};
    challengeTimingsRef.current = {};
    challengeStartedAtRef.current = 0;
    setChallengeIndex(0);
    setChallengeSecondsLeft(5);
    setChallengeOpen(true);
    setChallengeLoading(true);
    try {
      const response = await fetch(
        `/api/medtech/question-pack-reward?packageName=${encodeURIComponent(packageName)}&pack=${packNumber}&challenge=1`,
      );
      const result = (await response.json()) as {
        questions?: ChallengeQuestion[];
        error?: string;
      };
      if (!response.ok || !result.questions?.length)
        throw new Error(
          result.error || "目前沒有可用的前一關題目，請先完成上一關。 ",
        );
      setChallengeQuestions(result.questions);
    } catch (reason) {
      setChallengeQuestions([]);
      setChallengeError(
        reason instanceof Error
          ? reason.message
          : "答題挑戰暫時無法使用，請稍後再試。",
      );
    } finally {
      setChallengeLoading(false);
    }
  }

  function chooseChallengeAnswer(answer: string) {
    const question = challengeQuestions[challengeIndex];
    if (!question || challengeBusy || challengeSecondsLeft <= 0) return;
    const seconds = Math.max(
      0,
      Math.min(5, (Date.now() - challengeStartedAtRef.current) / 1000),
    );
    challengeTimingsRef.current[question.id] = Number(seconds.toFixed(1));
    setChallengeAnswers((current) => {
      const next = { ...current, [question.id]: answer };
      challengeAnswersRef.current = next;
      return next;
    });
  }

  async function submitChallenge() {
    if (challengeBusy || !challengeQuestions.length) return;
    setChallengeBusy(true);
    setChallengeError("");
    try {
      const response = await fetch("/api/medtech/question-pack-reward", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          packageName,
          pack: packNumber,
          action: "quiz",
          questionIds: challengeQuestions.map((question) => question.id),
          answers: Object.entries(challengeAnswersRef.current).map(
            ([questionId, answer]) => ({
              questionId: Number(questionId),
              answer,
            }),
          ),
          timings: Object.entries(challengeTimingsRef.current).map(
            ([questionId, seconds]) => ({
              questionId: Number(questionId),
              seconds,
            }),
          ),
        }),
      });
      const result = (await response.json()) as {
        score?: number;
        total?: number;
        averageSeconds?: number;
        attemptsRemaining?: number;
        reward?: Reward;
        error?: string;
      };
      if (!response.ok || !result.reward)
        throw new Error(result.error || "答題挑戰暫時無法完成，請稍後再試。");
      const nextResult = {
        score: result.score ?? 0,
        total: result.total ?? challengeQuestions.length,
        averageSeconds: result.averageSeconds ?? 5,
        attemptsRemaining: result.attemptsRemaining ?? 0,
        reward: result.reward,
      };
      setChallengeResult(nextResult);
      setChallengeAttemptsRemaining(nextResult.attemptsRemaining);
      setReward(result.reward);
    } catch (reason) {
      setChallengeError(
        reason instanceof Error
          ? reason.message
          : "答題挑戰暫時無法完成，請稍後再試。",
      );
    } finally {
      setChallengeBusy(false);
    }
  }

  function advanceChallenge(force = false) {
    const question = challengeQuestions[challengeIndex];
    if (!question || (!force && !challengeAnswersRef.current[question.id]))
      return;
    if (!challengeTimingsRef.current[question.id])
      challengeTimingsRef.current[question.id] = 5;
    if (challengeIndex >= challengeQuestions.length - 1) {
      void submitChallenge();
      return;
    }
    setChallengeIndex((current) => current + 1);
  }

  useEffect(() => {
    const question = challengeQuestions[challengeIndex];
    if (
      !challengeOpen ||
      challengeLoading ||
      challengeResult ||
      challengeBusy ||
      !question
    )
      return;
    const deadline = Date.now() + 5000;
    challengeStartedAtRef.current = Date.now();
    setChallengeSecondsLeft(5);
    const timer = window.setInterval(() => {
      const seconds = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      setChallengeSecondsLeft(seconds);
      if (seconds <= 0) {
        window.clearInterval(timer);
        advanceChallenge(true);
      }
    }, 100);
    return () => window.clearInterval(timer);
  }, [
    challengeOpen,
    challengeLoading,
    challengeResult,
    challengeBusy,
    challengeIndex,
    challengeQuestions,
  ]);

  async function spin() {
    if (busy || reward) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/medtech/question-pack-reward", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ packageName, pack: packNumber, action: "spin" }),
      });
      const result = (await response.json()) as {
        reward?: Reward;
        error?: string;
      };
      if (!response.ok || !result.reward)
        throw new Error(result.error || "轉轉樂暫時無法使用，請稍後再試。");
      const nextReward = result.reward;
      if (nextReward.status !== "revealed") {
        setReward(nextReward);
        setBusy(false);
        return;
      }
      const target = wheelAngles[nextReward.label || "原價"] ?? 270;
      setWheelRotation((current) => current + 1440 + target);
      setSpinning(true);
      await new Promise((resolve) => window.setTimeout(resolve, 1750));
      setReward(nextReward);
      setSpinning(false);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "轉轉樂暫時無法使用，請稍後再試。",
      );
    }
    setBusy(false);
  }

  const retryText = remainingRetryText(reward?.retryAt, now);
  const isOriginal = reward?.label === "原價";
  const canChallengeAgain = Boolean(
    reward &&
      (reward.quizAttemptsRemaining ?? 0) > 0 &&
      reward.percent !== 50 &&
      (isOriginal || (reward.quizAttemptsUsed ?? 0) > 0),
  );

  return (
    <>
      <div
        className={`medtech-pack-discount-card${isOriginal ? " is-original" : ""}`}
      >
        <div className="medtech-pack-discount-topline">
          <span>第 {packNumber} 關</span>
          <i aria-hidden="true">🎡</i>
        </div>
        <b>{questionTotal} 題</b>
        <small>{label}</small>
        {!loaded ? (
          <span className="medtech-discount-loading">
            <span className="medtech-loading-spinner" /> 優惠方式讀取中…
          </span>
        ) : used ? (
          <div className="medtech-discount-revealed">
            <strong>本關已使用過優惠</strong>
            <button
              type="button"
              className="medtech-discount-unlock-button"
              onClick={() => void unlockInPlace()}
              disabled={unlocking}
              aria-busy={unlocking}
            >
              {unlocking ? (
                <>
                  <span className="medtech-loading-spinner" /> 處理中…
                </>
              ) : (
                "NT$30 購買並開始練習 →"
              )}
            </button>
          </div>
        ) : reward ? (
          <div className="medtech-discount-revealed">
            <strong>
              {isOriginal ? "這次抽到原價" : `🎉 抽到${reward.label || "優惠"}`}
              ｜NT${"$"}
              {reward.cost ?? 30}
            </strong>
            {isOriginal && retryText && <em>{retryText}</em>}
            {canChallengeAgain && (
              <button
                type="button"
                className="medtech-discount-challenge"
                onClick={() => void openChallenge()}
              >
                🧠 再挑戰（剩 {reward.quizAttemptsRemaining} 次）
              </button>
            )}
            <button
              type="button"
              className="medtech-discount-unlock-button"
              onClick={() => void unlockInPlace()}
              disabled={unlocking}
              aria-busy={unlocking}
            >
              {unlocking ? (
                <>
                  <span className="medtech-loading-spinner" /> 處理中…
                </>
              ) : (
                `NT$${reward.cost ?? 30} 購買並開始練習 →`
              )}
            </button>
          </div>
        ) : (
          <div className="medtech-discount-actions">
            <button
              type="button"
              onClick={() => void openChallenge()}
              disabled={busy || challengeAttemptsRemaining <= 0}
              aria-busy={challengeLoading}
            >
              🧠 答題挑戰折扣
            </button>
            <button
              type="button"
              className="secondary"
              onClick={openWheel}
              disabled={busy}
              aria-busy={busy}
            >
              🎡 打開轉轉樂
            </button>
          </div>
        )}
        {error && <em>{error}</em>}
      </div>
      {open && (
        <div
          className="medtech-spin-backdrop"
          role="presentation"
          onMouseDown={closeWheel}
        >
          <section
            className="medtech-spin-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="medtech-spin-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              className="medtech-spin-close"
              onClick={closeWheel}
              disabled={busy}
              aria-label="關閉"
            >
              ×
            </button>
            <span className="medtech-spin-kicker">LIMITED-TIME SPIN</span>
            <h2 id="medtech-spin-title">🎡 轉轉樂</h2>
            <p>
              抽到優惠就用優惠價解鎖；如果抽到原價，24 小時後可以再來試一次。
            </p>
            <div className="medtech-spin-stage" aria-live="polite">
              <span className="medtech-spin-spark spark-one" aria-hidden="true">
                ✦
              </span>
              <span className="medtech-spin-spark spark-two" aria-hidden="true">
                ✧
              </span>
              <span className="medtech-spin-pointer" aria-hidden="true">
                ▼
              </span>
              <div
                className={`medtech-spin-wheel${spinning ? " is-spinning" : ""}`}
                style={
                  {
                    "--medtech-wheel-rotation": `${wheelRotation}deg`,
                  } as CSSProperties
                }
              >
                <span className="wheel-label wheel-five">五折</span>
                <span className="wheel-label wheel-seventy-five">七五折</span>
                <span className="wheel-label wheel-ninety">九折</span>
                <span className="wheel-label wheel-original">原價</span>
                <span className="medtech-spin-wheel-center">✦</span>
              </div>
            </div>
            {!reward ? (
              <button
                type="button"
                className="medtech-spin-start"
                onClick={() => void spin()}
                disabled={busy}
                aria-busy={busy}
              >
                {busy ? (
                  <>
                    <span className="medtech-loading-spinner" /> 抽獎中…
                  </>
                ) : (
                  "開始抽獎"
                )}
              </button>
            ) : (
              <div
                className={`medtech-spin-result${isOriginal ? " original" : ""}`}
              >
                <strong>
                  {isOriginal ? "這次是原價" : `恭喜你抽到${reward.label}`}
                </strong>
                <span>
                  {isOriginal
                    ? `${retryText || "24 小時後可再抽一次"}；現在也能以 NT$${reward.cost ?? 30} 購買。`
                    : `本關優惠價 NT$${reward.cost ?? 30}。`}
                </span>
                <button
                  type="button"
                  className="medtech-discount-unlock-button"
                  onClick={() => void unlockInPlace()}
                  disabled={unlocking}
                  aria-busy={unlocking}
                >
                  {unlocking ? (
                    <>
                      <span className="medtech-loading-spinner" /> 處理中…
                    </>
                  ) : (
                    `NT$${reward.cost ?? 30} 購買並開始練習 →`
                  )}
                </button>
              </div>
            )}
            {error && <em className="medtech-spin-error">{error}</em>}
          </section>
        </div>
      )}
      {challengeOpen && (
        <div
          className="medtech-spin-backdrop"
          role="presentation"
          onMouseDown={closeChallenge}
        >
          <section
            className="medtech-challenge-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="medtech-challenge-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              className="medtech-spin-close"
              onClick={closeChallenge}
              disabled={
                challengeBusy ||
                challengeLoading ||
                Boolean(challengeQuestions.length && !challengeResult)
              }
              aria-label="關閉"
            >
              ×
            </button>
            <span className="medtech-spin-kicker">DISCOUNT QUIZ</span>
            <h2 id="medtech-challenge-title">🧠 答題挑戰折扣</h2>
            <p>
              從上一關的 30 題中隨機抽出 10 題；每題限時 5
              秒，逾時會記為未作答並自動進入下一題。不可暫停或回上一題；每個題目包最多
              2 次挑戰，答對越多、平均作答越快，折扣越優惠，兩次取最佳結果。
            </p>
            {challengeLoading ? (
              <div className="medtech-challenge-loading">
                <span className="medtech-loading-spinner" /> 題目讀取中…
              </div>
            ) : challengeResult ? (
              <div className="medtech-challenge-result">
                <strong>
                  你答對 {challengeResult.score}／{challengeResult.total} 題
                </strong>
                <span>
                  平均作答 {challengeResult.averageSeconds.toFixed(1)}{" "}
                  秒；目前最佳折扣：{challengeResult.reward.label}（ NT$
                  {challengeResult.reward.cost ?? 30}）
                  {challengeResult.attemptsRemaining > 0
                    ? `；還可挑戰 ${challengeResult.attemptsRemaining} 次`
                    : "。"}
                </span>
                <button
                  type="button"
                  className="medtech-discount-unlock-button"
                  onClick={() => void unlockInPlace()}
                  disabled={unlocking}
                  aria-busy={unlocking}
                >
                  {unlocking ? (
                    <>
                      <span className="medtech-loading-spinner" /> 解鎖中…
                    </>
                  ) : (
                    `NT$${challengeResult.reward.cost ?? 30} 購買並開始練習 →`
                  )}
                </button>
              </div>
            ) : challengeQuestions[challengeIndex] ? (
              <div className="medtech-challenge-question">
                <div className="medtech-challenge-question-meta">
                  <small>
                    第 {challengeIndex + 1}／{challengeQuestions.length} 題
                  </small>
                  <strong className={challengeSecondsLeft <= 2 ? "urgent" : ""}>
                    ⏱ {challengeSecondsLeft} 秒
                  </strong>
                </div>
                <h3>{challengeQuestions[challengeIndex].stem}</h3>
                <div className="medtech-challenge-options">
                  {["A", "B", "C", "D"].map((letter) => (
                    <button
                      type="button"
                      key={letter}
                      className={
                        challengeAnswers[
                          challengeQuestions[challengeIndex].id
                        ] === letter
                          ? "selected"
                          : ""
                      }
                      onClick={() => chooseChallengeAnswer(letter)}
                    >
                      <b>{letter}</b>
                      <span>
                        {challengeQuestions[challengeIndex].options[letter] ||
                          ""}
                      </span>
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  className="medtech-challenge-next"
                  onClick={() => advanceChallenge()}
                  disabled={
                    !challengeAnswers[challengeQuestions[challengeIndex].id] ||
                    challengeBusy
                  }
                >
                  {challengeBusy ? (
                    <>
                      <span className="medtech-loading-spinner" /> 計算折扣中…
                    </>
                  ) : challengeIndex >= challengeQuestions.length - 1 ? (
                    "送出挑戰"
                  ) : (
                    "下一題 →"
                  )}
                </button>
              </div>
            ) : (
              <div className="medtech-challenge-error">
                {challengeError || "目前沒有可用的挑戰題目。"}
              </div>
            )}
            {challengeError &&
              !challengeLoading &&
              !challengeQuestions[challengeIndex] && (
                <em className="medtech-spin-error">{challengeError}</em>
              )}
          </section>
        </div>
      )}
    </>
  );
}
