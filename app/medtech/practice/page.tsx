"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import MedtechTabs from "../MedtechTabs";
import MedtechHeaderActions from "../MedtechHeaderActions";
import { useMedtechProductSettings } from "../useMedtechProductSettings";

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
  session?: {
    id: number;
    status:
      | "in_progress"
      | "paused"
      | "awaiting_submit"
      | "completed"
      | "expired";
    startedAt: string;
    lastActiveAt: string | null;
    lastQuestionIndex: number;
    durationSeconds: number;
    answeredQuestions: number;
    answerDetails: Array<{
      questionId: number;
      order: number;
      answer: string | null;
      durationSeconds: number;
      answeredAt: string | null;
      correct?: boolean | null;
    }>;
  } | null;
  packageAccess?: {
    name: string;
    cost: number;
    baseCost?: number;
    questionCount: number;
    days: number;
    packageNumber?: number;
    packageCount?: number;
    isBonus?: boolean;
    locked: boolean;
    gifted?: boolean;
    charged?: boolean;
    allAccess?: boolean;
    discountReward?: {
      status: "available" | "revealed" | "abandoned" | "used";
      label: string | null;
      percent: number | null;
      cost: number;
      baseCost: number;
    } | null;
    needsUnlock?: boolean;
    blockedByPrevious?: boolean;
    availableUntil?: string | null;
  };
};

type ProgressDetail = {
  questionId: number;
  order: number;
  answer: string | null;
  durationSeconds: number;
  answeredAt: string | null;
  correct?: boolean | null;
};
type SessionStatus =
  | "in_progress"
  | "paused"
  | "awaiting_submit"
  | "completed"
  | "expired";

const letters = ["A", "B", "C", "D"];

function explanationSections(value: string) {
  const text = value.trim();
  const markerPattern = /(?:^|[\s（(])([A-D])\s*[、，,：:]\s*/gu;
  const markers = [...text.matchAll(markerPattern)].filter(
    (match) => match.index !== undefined,
  );
  const firstOption = markers.find((match) => match[1] === "A");
  if (!firstOption || firstOption.index === undefined)
    return [{ label: "", text }];
  const sections = [
    { label: "", text: text.slice(0, firstOption.index).trim() },
  ].filter((section) => section.text);
  const optionMarkers = markers.filter(
    (match) =>
      match.index !== undefined &&
      match.index >= firstOption.index! &&
      letters.includes(match[1]),
  );
  for (const [position, marker] of optionMarkers.entries()) {
    const start = marker.index! + marker[0].length;
    const end = optionMarkers[position + 1]?.index ?? text.length;
    const sectionText = text.slice(start, end).trim();
    if (sectionText) sections.push({ label: marker[1], text: sectionText });
  }
  return sections.length > 1 ? sections : [{ label: "", text }];
}

function FormattedExplanation({ value }: { value: string }) {
  const sections = explanationSections(value);
  return (
    <div className="medtech-explanation-copy">
      {sections.map((section, index) =>
        section.label ? (
          <div
            className="medtech-explanation-option"
            key={`${section.label}-${index}`}
          >
            <b>{section.label}</b>
            <p>{section.text}</p>
          </div>
        ) : (
          <p key={`intro-${index}`}>{section.text}</p>
        ),
      )}
    </div>
  );
}

async function readJson(response: Response) {
  const text = await response.text();
  if (!text.trim()) {
    throw new Error(
      response.ok
        ? "題庫沒有回傳資料，請稍後再試。"
        : "題庫服務暫時忙碌，請稍後重新整理。",
    );
  }
  try {
    return JSON.parse(text) as ApiResult;
  } catch {
    throw new Error("題庫回應格式錯誤，請稍後重新整理。");
  }
}

export default function MedtechPractice() {
  const product = useMedtechProductSettings();
  const [rows, setRows] = useState<Question[]>([]);
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [submitted, setSubmitted] = useState(false);
  const [flagged, setFlagged] = useState<number[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [unlockingId, setUnlockingId] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [unlockingPackage, setUnlockingPackage] = useState(false);
  const [discountAction, setDiscountAction] = useState<"spin" | "abandon" | "">(
    "",
  );
  const [mastering, setMastering] = useState(false);
  const [fullNotice, setFullNotice] = useState("");
  const [sessionId, setSessionId] = useState<number | null>(null);
  const [packageAccess, setPackageAccess] = useState<NonNullable<
    ApiResult["packageAccess"]
  > | null>(null);
  const [sessionStatus, setSessionStatus] =
    useState<SessionStatus>("in_progress");
  const [questionSeconds, setQuestionSeconds] = useState(0);
  const [totalSeconds, setTotalSeconds] = useState(0);
  const [paywallOpen, setPaywallOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [route, setRoute] = useState({
    ready: false,
    topic: "",
    wrongOnly: false,
    focus: 0,
    pack: 1,
    questionOrder: "ordered",
    optionOrder: "ordered",
  });
  const answersRef = useRef<Record<number, string>>({});
  const detailsRef = useRef<Record<number, ProgressDetail>>({});
  const questionTimesRef = useRef<Record<number, number>>({});
  const optionOrderRef = useRef<Record<number, string[]>>({});
  const activeTimerRef = useRef<{
    questionId: number;
    startedAt: number;
  } | null>(null);
  const totalSecondsRef = useRef(0);
  const sessionStatusRef = useRef(sessionStatus);
  const saveRequestRef = useRef<Promise<unknown> | null>(null);
  const submittingRef = useRef(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setRoute({
      ready: true,
      topic: params.get("topic") || "",
      wrongOnly: params.get("wrongOnly") === "1",
      focus: Number(params.get("focus")) || 0,
      pack: Math.max(1, Math.floor(Number(params.get("pack")) || 1)),
      questionOrder:
        params.get("questionOrder") === "random" ? "random" : "ordered",
      optionOrder:
        params.get("optionOrder") === "random" ? "random" : "ordered",
    });
  }, []);

  const { topic, wrongOnly, focus, pack, questionOrder, optionOrder } = route;

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!route.ready) return;
    setLoading(true);
    setError("");
    setRows([]);
    setIndex(0);
    applyAnswers({});
    detailsRef.current = {};
    questionTimesRef.current = {};
    optionOrderRef.current = {};
    totalSecondsRef.current = 0;
    setQuestionSeconds(0);
    setTotalSeconds(0);
    setSessionStatus("in_progress");
    setSubmitted(false);
    setSessionId(null);
    setPackageAccess(null);
    setDiscountAction("");
    setPaywallOpen(false);
    const query = new URLSearchParams({
      limit: "30",
      mode: "practice",
      pack: String(pack),
    });
    if (topic) query.set("topic", topic);
    if (wrongOnly) query.set("wrongOnly", "1");
    fetch("/api/medtech/questions?" + query.toString())
      .then(async (response) => {
        const result = await readJson(response);
        if (!response.ok) throw new Error(result.error || "題庫讀取失敗");
        setRows(result.items ?? []);
        setSessionId(result.sessionId ?? null);
        setPackageAccess(result.packageAccess ?? null);
        const orderSeed = result.sessionId ?? 17;
        optionOrderRef.current = Object.fromEntries(
          (result.items ?? []).map((item) => [
            item.id,
            optionOrder === "random"
              ? createOptionOrder(item.id, orderSeed)
              : [...letters],
          ]),
        );
        const savedDetails = result.session?.answerDetails ?? [];
        const restoredAnswers: Record<number, string> = {};
        const restoredDetails: Record<number, ProgressDetail> = {};
        for (const detail of savedDetails) {
          const normalized = { ...detail, answer: detail.answer ?? null };
          restoredDetails[detail.questionId] = normalized;
          questionTimesRef.current[detail.questionId] =
            normalized.durationSeconds;
          if (normalized.answer)
            restoredAnswers[detail.questionId] = normalized.answer;
        }
        detailsRef.current = restoredDetails;
        answersRef.current = restoredAnswers;
        applyAnswers(restoredAnswers);
        totalSecondsRef.current =
          result.session?.durationSeconds ??
          Object.values(questionTimesRef.current).reduce(
            (sum, seconds) => sum + seconds,
            0,
          );
        setTotalSeconds(totalSecondsRef.current);
        setSessionStatus(result.session?.status ?? "in_progress");
        if (focus && result.items?.length) {
          const focusedIndex = result.items.findIndex(
            (item) => item.id === focus,
          );
          if (focusedIndex >= 0) setIndex(focusedIndex);
        } else if (
          result.session &&
          result.session.lastQuestionIndex >= 0 &&
          result.session.lastQuestionIndex < (result.items?.length ?? 0)
        ) {
          setIndex(result.session.lastQuestionIndex);
        }
        if (!result.items?.length)
          setError(result.message || "目前沒有符合條件的醫檢師題目。");
      })
      .catch((reason) =>
        setError(reason instanceof Error ? reason.message : "題庫讀取失敗"),
      )
      .finally(() => setLoading(false));
  }, [route.ready, topic, wrongOnly, pack, focus, questionOrder, optionOrder]);

  const q = rows[index];
  const chapterName = wrongOnly
    ? "錯題複習"
    : topic ||
      (packageAccess?.name === "隨機模考"
        ? "隨機模考"
        : q?.chapter || q?.topic || "章節未標示");
  const score = useMemo(
    () => rows.filter((item) => answers[item.id] === item.answer).length,
    [answers, rows],
  );
  const answered = Object.keys(answers).length;
  const packageExpiry = packageAccess?.availableUntil
    ? new Date(packageAccess.availableUntil).getTime()
    : null;
  const packageRemaining = packageExpiry
    ? Math.max(0, packageExpiry - now)
    : null;
  const formatRemaining = (milliseconds: number) => {
    const totalMinutes = Math.floor(milliseconds / 60000);
    const days = Math.floor(totalMinutes / 1440);
    const hours = Math.floor((totalMinutes % 1440) / 60);
    const minutes = totalMinutes % 60;
    return days > 0
      ? `${days} 天 ${hours} 小時`
      : hours > 0
        ? `${hours} 小時 ${minutes} 分`
        : `${minutes} 分鐘`;
  };

  useEffect(() => {
    sessionStatusRef.current = sessionStatus;
  }, [sessionStatus]);

  const formatDuration = (seconds: number) => {
    const safe = Math.max(0, Math.floor(seconds));
    const hours = Math.floor(safe / 3600);
    const minutes = Math.floor((safe % 3600) / 60);
    const rest = safe % 60;
    return hours
      ? `${hours}小時 ${String(minutes).padStart(2, "0")}分`
      : `${String(minutes).padStart(2, "0")}分 ${String(rest).padStart(2, "0")}秒`;
  };

  function flushActiveTimer() {
    const active = activeTimerRef.current;
    if (!active) return;
    const elapsed = Math.max(
      0,
      Math.floor((Date.now() - active.startedAt) / 1000),
    );
    if (elapsed > 0) {
      questionTimesRef.current[active.questionId] =
        (questionTimesRef.current[active.questionId] ?? 0) + elapsed;
      totalSecondsRef.current += elapsed;
    }
    activeTimerRef.current = null;
    setQuestionSeconds(questionTimesRef.current[active.questionId] ?? 0);
    setTotalSeconds(totalSecondsRef.current);
    const order = rows.findIndex((item) => item.id === active.questionId);
    const current = detailsRef.current[active.questionId];
    detailsRef.current[active.questionId] = {
      questionId: active.questionId,
      order: order >= 0 ? order : (current?.order ?? 0),
      answer: answersRef.current[active.questionId] ?? null,
      durationSeconds: questionTimesRef.current[active.questionId] ?? 0,
      answeredAt: current?.answeredAt ?? null,
      correct: current?.correct ?? null,
    };
  }

  function startActiveTimer(questionId: number) {
    if (
      !questionId ||
      answersRef.current[questionId] ||
      document.hidden ||
      submitted ||
      wrongOnly
    )
      return;
    if (activeTimerRef.current?.questionId === questionId) return;
    activeTimerRef.current = { questionId, startedAt: Date.now() };
  }

  function progressDetails() {
    return Object.values(detailsRef.current).sort(
      (left, right) => left.order - right.order,
    );
  }

  async function saveProgress(
    status:
      | "in_progress"
      | "paused"
      | "awaiting_submit" = sessionStatusRef.current as
      | "in_progress"
      | "paused"
      | "awaiting_submit",
    flush = true,
  ) {
    if (!sessionId || wrongOnly || submitted || submittingRef.current) return;
    if (flush) flushActiveTimer();
    const nextDetails = progressDetails();
    sessionStatusRef.current = status;
    setSessionStatus(status);
    const request = fetch("/api/medtech/questions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      keepalive: true,
      body: JSON.stringify({
        action: "save-progress",
        sessionId,
        status,
        currentIndex: index,
        elapsedSeconds: totalSecondsRef.current,
        answerDetails: nextDetails,
      }),
    });
    const trackedRequest = request.catch(() => undefined);
    saveRequestRef.current = trackedRequest;
    void trackedRequest.finally(() => {
      if (saveRequestRef.current === trackedRequest)
        saveRequestRef.current = null;
    });
    if (
      flush &&
      q &&
      !answersRef.current[q.id] &&
      !document.hidden &&
      !submitted
    )
      startActiveTimer(q.id);
  }

  function applyAnswers(next: Record<number, string>) {
    answersRef.current = next;
    setAnswers(next);
  }

  function createOptionOrder(questionId: number, seed: number) {
    const order = [...letters];
    let value = Math.abs((questionId * 2654435761 + seed * 40503) | 0) || 1;
    for (let current = order.length - 1; current > 0; current -= 1) {
      value = (value * 1664525 + 1013904223) | 0;
      const target = Math.abs(value) % (current + 1);
      [order[current], order[target]] = [order[target], order[current]];
    }
    return order;
  }

  function displayedOptionOrder(questionId: number) {
    return optionOrderRef.current[questionId] ?? letters;
  }

  function displayedLetter(questionId: number, originalLetter: string) {
    const position = displayedOptionOrder(questionId).indexOf(originalLetter);
    return position >= 0 ? letters[position] : originalLetter;
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const tagName = target?.tagName?.toLowerCase();
      if (
        event.defaultPrevented ||
        event.ctrlKey ||
        event.altKey ||
        event.metaKey ||
        tagName === "input" ||
        tagName === "textarea" ||
        tagName === "select" ||
        target?.isContentEditable ||
        paywallOpen
      )
        return;
      // 題目包尚未解鎖時仍可點左側題號查看完整題目，但不啟用鍵盤換題或作答快捷鍵。
      if (q?.locked) return;
      if (event.key === "ArrowLeft") {
        if (index > 0) {
          event.preventDefault();
          setIndex((current) => Math.max(0, current - 1));
        }
        return;
      }
      if (event.key === "ArrowRight") {
        if (index < rows.length - 1) {
          event.preventDefault();
          setIndex((current) => Math.min(rows.length - 1, current + 1));
        }
        return;
      }
      if (
        !submitted &&
        !submittingRef.current &&
        /^[1-4]$/.test(event.key) &&
        q
      ) {
        event.preventDefault();
        const letter = letters[Number(event.key) - 1];
        if (q.locked) setPaywallOpen(true);
        else chooseAnswer(letter);
        return;
      }
      if (event.key === "0" && !submittingRef.current && q) {
        event.preventDefault();
        setFlagged((value) =>
          value.includes(q.id)
            ? value.filter((id) => id !== q.id)
            : [...value, q.id],
        );
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [index, paywallOpen, q?.id, q?.locked, rows.length, submitted]);

  function resetProgressState() {
    activeTimerRef.current = null;
    detailsRef.current = {};
    questionTimesRef.current = {};
    totalSecondsRef.current = 0;
    setQuestionSeconds(0);
    setTotalSeconds(0);
    sessionStatusRef.current = "in_progress";
    setSessionStatus("in_progress");
    applyAnswers({});
  }

  useEffect(() => {
    if (!q || loading || submitted || wrongOnly || q.locked) {
      activeTimerRef.current = null;
      setQuestionSeconds(q ? (questionTimesRef.current[q.id] ?? 0) : 0);
      return;
    }
    setQuestionSeconds(questionTimesRef.current[q.id] ?? 0);
    startActiveTimer(q.id);
    const timer = window.setInterval(() => {
      const active = activeTimerRef.current;
      if (!active || active.questionId !== q.id) return;
      const live =
        (questionTimesRef.current[q.id] ?? 0) +
        Math.max(0, Math.floor((Date.now() - active.startedAt) / 1000));
      setQuestionSeconds(live);
      setTotalSeconds(
        totalSecondsRef.current +
          Math.max(0, Math.floor((Date.now() - active.startedAt) / 1000)),
      );
    }, 1000);
    return () => {
      window.clearInterval(timer);
      flushActiveTimer();
    };
  }, [q?.id, loading, submitted, wrongOnly]);

  useEffect(() => {
    if (!sessionId || wrongOnly || submitted) return;
    const timer = window.setInterval(() => {
      void saveProgress(
        sessionStatusRef.current as
          | "in_progress"
          | "paused"
          | "awaiting_submit",
      );
    }, 15000);
    return () => window.clearInterval(timer);
  }, [sessionId, wrongOnly, submitted, index, q?.id]);

  useEffect(() => {
    if (!sessionId || wrongOnly) return;
    const onVisibilityChange = () => {
      if (document.hidden)
        void saveProgress(
          answered >= rows.length ? "awaiting_submit" : "paused",
        );
      else if (!submitted) {
        const nextStatus: SessionStatus =
          answered >= rows.length ? "awaiting_submit" : "in_progress";
        sessionStatusRef.current = nextStatus;
        setSessionStatus(nextStatus);
        if (q && !answersRef.current[q.id]) startActiveTimer(q.id);
        void saveProgress(nextStatus, false);
      }
    };
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!submitted) {
        void saveProgress(
          answered >= rows.length ? "awaiting_submit" : "paused",
        );
        if (answered < rows.length) {
          event.preventDefault();
          event.returnValue = "";
        }
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, [sessionId, wrongOnly, submitted, q?.id, answered, rows.length]);

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
      <MedtechTabs
        active={wrongOnly ? "wrong" : topic ? "chapters" : "random"}
      />
    </>
  );

  async function unlockPackage() {
    if (unlockingPackage || wrongOnly) return;
    setUnlockingPackage(true);
    setError("");
    try {
      const query = new URLSearchParams({
        limit: "30",
        mode: "practice",
        pack: String(pack),
        unlock: "1",
        questionOrder,
        optionOrder,
      });
      if (topic) query.set("topic", topic);
      const response = await fetch(
        "/api/medtech/questions?" + query.toString(),
        { cache: "no-store" },
      );
      const result = await readJson(response);
      setPackageAccess(result.packageAccess ?? null);
      if (result.packageAccess?.blockedByPrevious) {
        setPaywallOpen(false);
        setError("請先完成上一關，下一關才會開放。");
        return;
      }
      if (!response.ok || result.packageAccess?.locked) {
        setPaywallOpen(true);
        return;
      }
      window.dispatchEvent(new Event("medtech-points-updated"));
      setRows(result.items ?? []);
      setSessionId(result.sessionId ?? null);
      const orderSeed = result.sessionId ?? 17;
      optionOrderRef.current = Object.fromEntries(
        (result.items ?? []).map((item) => [
          item.id,
          optionOrder === "random"
            ? createOptionOrder(item.id, orderSeed)
            : [...letters],
        ]),
      );
      setIndex(0);
      resetProgressState();
      setSubmitted(false);
      setPaywallOpen(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "題目包解鎖失敗");
    } finally {
      setUnlockingPackage(false);
    }
  }

  async function choosePackDiscount(action: "spin" | "abandon") {
    if (
      discountAction ||
      !packageAccess?.locked ||
      packageAccess.blockedByPrevious
    )
      return;
    setDiscountAction(action);
    setError("");
    try {
      const response = await fetch("/api/medtech/question-pack-reward", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          packageName: topic || "隨機模考",
          pack,
          action,
        }),
      });
      const result = (await response.json()) as {
        reward?: NonNullable<ApiResult["packageAccess"]>["discountReward"];
        error?: string;
      };
      if (!response.ok || !result.reward)
        throw new Error(result.error || "轉轉樂暫時無法使用，請稍後再試。");
      setPackageAccess((current) =>
        current
          ? {
              ...current,
              discountReward: result.reward,
              cost: result.reward?.cost ?? current.cost,
            }
          : current,
      );
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "轉轉樂暫時無法使用，請稍後再試。",
      );
    } finally {
      setDiscountAction("");
    }
  }

  async function submitExam() {
    if (submittingRef.current) return;
    if (q?.locked) {
      void unlockPackage();
      return;
    }
    const currentAnswers = answersRef.current;
    const answeredNow = Object.keys(currentAnswers).length;
    if (!wrongOnly && answeredNow < rows.length) {
      const nextUnanswered = rows.findIndex((item) => !currentAnswers[item.id]);
      setFullNotice(
        `尚有 ${rows.length - answeredNow} 題未作答，請完成全部題目後再交卷。`,
      );
      if (nextUnanswered >= 0) setIndex(nextUnanswered);
      void saveProgress("in_progress");
      return;
    }
    submittingRef.current = true;
    setSubmitting(true);
    sessionStatusRef.current = "awaiting_submit";
    setSessionStatus("awaiting_submit");
    setFullNotice("");
    try {
      if (saveRequestRef.current) await saveRequestRef.current;
      flushActiveTimer();
      const payload = Object.entries(currentAnswers).map(
        ([questionId, answer]) => ({
          questionId: Number(questionId),
          answer,
        }),
      );
      if (payload.length) {
        const finalizeResponse = await fetch("/api/medtech/questions", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            action: "finalize",
            answers: payload,
            answerDetails: progressDetails(),
            elapsedSeconds: totalSecondsRef.current,
            sessionId,
          }),
        });
        const finalizeResult = await readJson(finalizeResponse);
        if (!finalizeResponse.ok)
          throw new Error(finalizeResult.error || "交卷失敗，請稍後再試。");
      }
      const ids = rows.map((item) => item.id).join(",");
      if (ids) {
        const response = await fetch(
          "/api/medtech/questions?mode=review&ids=" +
            ids +
            (sessionId ? `&sessionId=${sessionId}` : ""),
          { cache: "no-store" },
        );
        const result = await readJson(response);
        if (!response.ok)
          throw new Error(result.error || "答案與解析載入失敗，請稍後再試。");
        setRows((current) =>
          current.map((item) => {
            const detail = result.items?.find((next) => next.id === item.id);
            return detail ? { ...item, ...detail } : item;
          }),
        );
      }
      sessionStatusRef.current = "completed";
      setSessionStatus("completed");
      setSubmitted(true);
      setIndex(0);
    } catch (reason) {
      sessionStatusRef.current = "awaiting_submit";
      setSessionStatus("awaiting_submit");
      setFullNotice(
        reason instanceof Error
          ? reason.message
          : "交卷失敗，請稍後再試。請確認網路後再按一次交卷。",
      );
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  function chooseAnswer(letter: string) {
    if (!q || q.locked || submitted || submittingRef.current) return;
    flushActiveTimer();
    const next = { ...answersRef.current, [q.id]: letter };
    answersRef.current = next;
    const order = rows.findIndex((item) => item.id === q.id);
    detailsRef.current[q.id] = {
      questionId: q.id,
      order: order >= 0 ? order : index,
      answer: letter,
      durationSeconds: questionTimesRef.current[q.id] ?? 0,
      answeredAt: new Date().toISOString(),
      correct: letter === q.answer,
    };
    applyAnswers(next);
    const nextStatus: SessionStatus =
      Object.keys(next).length >= rows.length
        ? "awaiting_submit"
        : "in_progress";
    sessionStatusRef.current = nextStatus;
    setSessionStatus(nextStatus);
    void saveProgress(nextStatus, false);
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
      const result = (await response.json()) as {
        fullExplanation?: string;
        aiCredits?: number;
        error?: string;
      };
      if (!response.ok || !result.fullExplanation)
        throw new Error(result.error || "完整解析開啟失敗");
      setRows((current) =>
        current.map((item) =>
          item.id === questionId
            ? { ...item, fullExplanation: result.fullExplanation }
            : item,
        ),
      );
      window.dispatchEvent(new Event("medtech-points-updated"));
    } catch (reason) {
      setFullNotice(
        reason instanceof Error ? reason.message : "完整解析開啟失敗",
      );
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
      setIndex((current) =>
        Math.min(current, Math.max(0, remaining.length - 1)),
      );
      if (!remaining.length)
        setError("目前沒有待複習的錯題，你已完成這一輪複習。");
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
            <p>
              {submitting ? (
                <span className="medtech-loading-label">
                  <i className="medtech-loading-spinner" aria-hidden="true" />
                  正在載入答案與解析…
                </span>
              ) : (
                <>
                  答對率 {Math.round((score / rows.length) * 100)}% · 已作答{" "}
                  {answered} 題
                </>
              )}
            </p>
          </div>
          <button
            onClick={() => {
              setSubmitted(false);
              setIndex(0);
              resetProgressState();
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
                    className={
                      (i === index ? "active " : "") +
                      (picked === item.answer ? "review-right" : "review-wrong")
                    }
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
              <strong
                className={
                  isCorrect ? "review-status right" : "review-status wrong"
                }
              >
                {isCorrect ? "答對" : "答錯"}
              </strong>
            </header>
            <h2>{q.stem}</h2>
            <div className="medtech-review-answer-line">
              <span>
                你的答案：<b>{userAnswer || "未作答"}</b>
              </span>
              <span>
                {q.answerLabel || "答案"}：
                <b>{displayedLetter(q.id, q.answer)}</b>
              </span>
            </div>
            <div className="medtech-options medtech-review-options">
              {displayedOptionOrder(q.id).map((letter, displayIndex) => (
                <div
                  className={
                    (letter === q.answer ? "correct " : "") +
                    (letter === userAnswer && letter !== q.answer
                      ? "wrong"
                      : "")
                  }
                  key={letter}
                >
                  <b>{letters[displayIndex]}</b>
                  <span>{q.options[letter]}</span>
                  {letter === q.answer && (
                    <em>{q.answerLabel || "正確答案"}</em>
                  )}
                  {letter === userAnswer && letter !== q.answer && (
                    <em>你的答案</em>
                  )}
                </div>
              ))}
            </div>
            <section className="medtech-explanation">
              <span>簡要解析</span>
              {q.explanation?.trim() ? (
                <FormattedExplanation value={q.explanation} />
              ) : submitting ? (
                <p className="medtech-explanation-loading">
                  <span className="medtech-loading-label">
                    <i className="medtech-loading-spinner" aria-hidden="true" />
                    正在載入簡答解析…
                  </span>
                </p>
              ) : (
                <p>本題目前沒有可顯示的簡要解析。</p>
              )}
              {q.hasFullExplanation && !q.fullExplanation && (
                <button
                  className="medtech-full-explanation-button"
                  disabled={unlockingId === q.id}
                  onClick={() => void unlockFullExplanation(q.id)}
                >
                  {unlockingId === q.id ? "開啟中…" : "查看完整解析"}
                </button>
              )}
              {q.fullExplanation && (
                <div className="medtech-full-explanation">
                  <b>完整解析</b>
                  <FormattedExplanation value={q.fullExplanation} />
                </div>
              )}
              {fullNotice && (
                <small className="medtech-full-explanation-notice">
                  {fullNotice}
                </small>
              )}
              {q.answerLabel === "此為 AI 擬答" && (
                <small className="ai-answer-notice">
                  此為 AI 擬答，尚未有老師確認的標準答案。
                </small>
              )}
              <small>來源：{q.answerSource || "題庫"}</small>
            </section>
            <footer>
              <button
                disabled={index === 0}
                onClick={() => setIndex(index - 1)}
              >
                上一題
              </button>
              <span>逐題核對作答與教材答案</span>
              <button
                disabled={index === rows.length - 1}
                onClick={() => setIndex(index + 1)}
              >
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
          <span>
            {wrongOnly
              ? "個人錯題庫 · " + rows.length + " 題待複習"
              : `${packageAccess?.name || topic || "隨機模考"} · 第 ${packageAccess?.packageNumber ?? pack} 關 · ${rows.length} 題`}
          </span>
          <h1>{chapterName}</h1>
          <p>
            第 {index + 1}／{rows.length} 題 · {q.year} 年專技 · 本題{" "}
            {formatDuration(questionSeconds)} · 本回累計{" "}
            {formatDuration(totalSeconds)}
          </p>
        </div>
        <button
          onClick={() => void submitExam()}
          disabled={submitting}
          aria-busy={submitting}
        >
          {submitting ? (
            <span className="medtech-loading-label">
              <i className="medtech-loading-spinner" aria-hidden="true" />
              批改中…
            </span>
          ) : wrongOnly ? (
            "完成複習"
          ) : q.locked ? (
            "解鎖題目包"
          ) : (
            "交卷"
          )}
        </button>
      </section>
      {!wrongOnly && packageAccess && (
        <section
          className={`medtech-package-status ${packageAccess.locked ? "locked" : "active"}`}
        >
          <div>
            <b>
              {packageAccess.blockedByPrevious
                ? `第 ${packageAccess.packageNumber ?? pack} 關尚未開放`
                : packageAccess.locked
                  ? `第 ${packageAccess.packageNumber ?? pack} 關已列出，解鎖後開始作答`
                  : packageAccess.gifted
                    ? "本包首次體驗：免費贈送"
                    : packageAccess.isBonus
                      ? `尾包 ${packageAccess.questionCount} 題：已開通`
                      : `第 ${packageAccess.packageNumber ?? pack} 關已開通`}
            </b>
            <span>
              {packageAccess.blockedByPrevious
                ? "完成上一關後，下一關會自動開放。"
                : packageAccess.locked
                  ? "首次免費體驗已使用；開通全庫通行證後即可練習全部單元。"
                  : packageRemaining !== null
                    ? `剩餘 ${formatRemaining(packageRemaining)}；請把握時間完成練習。`
                    : `${packageAccess.days} 天內不限次數重做。`}
            </span>
            {!packageAccess.locked &&
              !wrongOnly &&
              sessionStatus !== "completed" && (
                <small className="medtech-session-reminder">
                  {sessionStatus === "paused"
                    ? "上次作答尚未完成，進度已保存；請完成本關後再交卷。"
                    : sessionStatus === "awaiting_submit"
                      ? "全部題目已作答，請按交卷完成本次紀錄。"
                      : `本次已作答 ${answered}/${rows.length} 題；離開頁面會自動保存。`}
                </small>
              )}
          </div>
          {false && packageAccess.locked &&
            !packageAccess.blockedByPrevious &&
            packageAccess.discountReward &&
            packageAccess.discountReward.status !== "available" && (
              <button
                type="button"
                onClick={() => void unlockPackage()}
                disabled={unlockingPackage}
                aria-busy={unlockingPackage}
              >
                {unlockingPackage ? "處理中…" : `NT$${packageAccess.cost} 購買`}
              </button>
            )}
          {false && packageAccess.locked &&
            !packageAccess.blockedByPrevious &&
            packageAccess.discountReward?.status === "available" && (
              <div className="medtech-pack-discount-box">
                <div>
                  <b>🎡 轉轉樂｜這一關只有一次機會</b>
                  <span>
                    最高五折；完成前一關後另可挑戰隨機 10 題，每題 5
                    秒，每包最多 2 次；放棄轉轉樂後就回到原價 NT$30。
                  </span>
                </div>
                <div>
                  <button
                    type="button"
                    onClick={() => void choosePackDiscount("spin")}
                    disabled={Boolean(discountAction)}
                    aria-busy={discountAction === "spin"}
                  >
                    {discountAction === "spin" ? (
                      <span className="medtech-loading-label">
                        <i
                          className="medtech-loading-spinner"
                          aria-hidden="true"
                        />
                        抽取中…
                      </span>
                    ) : (
                      "抽一次折扣"
                    )}
                  </button>
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => void choosePackDiscount("abandon")}
                    disabled={Boolean(discountAction)}
                  >
                    {discountAction === "abandon"
                      ? "處理中…"
                      : "放棄，原價購買"}
                  </button>
                </div>
              </div>
            )}
          {false && packageAccess.locked &&
            !packageAccess.blockedByPrevious &&
            packageAccess.discountReward?.status === "revealed" && (
              <div className="medtech-pack-discount-box revealed">
                <div>
                  <b>
                    🎉 抽到{packageAccess.discountReward.label}｜優惠價 NT${"$"}
                    {packageAccess.discountReward.cost}
                  </b>
                  <span>
                    這個折扣只適用本關一次；購買後 7 天內不限次數重做。
                  </span>
                </div>
              </div>
            )}
          {false && packageAccess.locked &&
            !packageAccess.blockedByPrevious &&
            packageAccess.discountReward?.status === "abandoned" && (
              <div className="medtech-pack-discount-box abandoned">
                <div>
                  <b>已放棄本關折扣｜原價 NT$30</b>
                  <span>
                    轉轉樂每一關只有一次機會；現在可以直接用原價購買。
                  </span>
                </div>
              </div>
            )}
        </section>
      )}
      {fullNotice && (
        <div className="medtech-submit-notice" role="alert" aria-live="polite">
          {fullNotice}
        </div>
      )}
      <div className="medtech-exam-grid">
        <aside className="medtech-question-map">
          <header>
            <b>{wrongOnly ? "錯題題號" : "題號"}</b>
            <span>
              {answered}／{rows.length} 已作答 · {formatDuration(totalSeconds)}
            </span>
          </header>
          <div>
            {rows.map((item, i) => (
              <button
                key={item.id}
                className={
                  (i === index ? "active " : "") +
                  (answers[item.id] ? "answered " : "") +
                  (flagged.includes(item.id) ? "flagged" : "")
                }
                disabled={Boolean(q.locked)}
                onClick={() => setIndex(i)}
              >
                {i + 1}
              </button>
            ))}
          </div>
          <small>
            {wrongOnly
              ? "答對或標記「我學會了」後移除"
              : packageAccess?.locked
                ? "題目完整列出；請點左側題號查看，解鎖後才能作答"
                : "實心＝已作答 · 圓點＝待確認"}
          </small>
          {q.locked ? (
            <div
              className="medtech-keyboard-help is-locked"
              aria-label="鎖定題目操作說明"
            >
              <b>操作說明</b>
              <span>未解鎖前不能換題或作答，請先解鎖題目包。</span>
            </div>
          ) : (
            <div className="medtech-keyboard-help" aria-label="刷題快捷鍵">
              <b>快捷鍵</b>
              <span>←／→ 換題</span>
              <span>1＝A</span>
              <span>2＝B</span>
              <span>3＝C</span>
              <span>4＝D</span>
              <span>0＝標記</span>
            </div>
          )}
        </aside>
        <section className="medtech-question">
          <header>
            <span>
              第 {index + 1} 題 {q.locked ? "· 尚未解鎖" : ""}
            </span>
            <div className="medtech-question-actions">
              {wrongOnly && (
                <button
                  className="mastered"
                  onClick={() => void markMastered()}
                  disabled={mastering}
                  aria-busy={mastering}
                >
                  {mastering ? (
                    <span className="medtech-loading-label">
                      <i
                        className="medtech-loading-spinner"
                        aria-hidden="true"
                      />
                      處理中…
                    </span>
                  ) : (
                    "✓ 我學會了"
                  )}
                </button>
              )}
              <button
                onClick={() =>
                  setFlagged((value) =>
                    value.includes(q.id)
                      ? value.filter((id) => id !== q.id)
                      : [...value, q.id],
                  )
                }
                disabled={q.locked}
              >
                {flagged.includes(q.id) ? "取消標記" : "標記待確認"}
              </button>
            </div>
          </header>
          <h2>{q.stem}</h2>
          <div className="medtech-options">
            {displayedOptionOrder(q.id).map((letter, displayIndex) => (
              <button
                className={answers[q.id] === letter ? "selected" : ""}
                key={letter}
                disabled={q.locked}
                onClick={() => chooseAnswer(letter)}
              >
                <b>{letters[displayIndex]}</b>
                <span>{q.options[letter]}</span>
              </button>
            ))}
          </div>
          <footer>
            <button
              disabled={q.locked || index === 0}
              onClick={() => setIndex(index - 1)}
            >
              上一題
            </button>
            <span>
              {q.locked
                ? product ? `本題需開通 NT$${product.effectivePrice}／${product.accessDays} 天全庫通行證` : "方案讀取中…"
                : "答案在完成前不顯示"}
            </span>
            <button
              disabled={q.locked || index === rows.length - 1}
              onClick={() => setIndex(index + 1)}
            >
              下一題
            </button>
          </footer>
        </section>
      </div>
      {paywallOpen && (
        <div
          className="medtech-paywall-backdrop"
          role="presentation"
          onMouseDown={() => setPaywallOpen(false)}
        >
          <section
            className="medtech-paywall"
            role="dialog"
            aria-modal="true"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <span>醫檢師全庫通行證</span>
            <h2>{product ? `NT$${product.effectivePrice} 開通完整題庫 ${product.accessDays} 天` : "方案讀取中…"}</h2>
            <p>
              30 題是學習進度單元，不再逐包計價。開通後 {product?.accessDays ?? "—"} 天內可不限次練習全部
              1,400+ 題、章節刷題、跨章節模考、全真模擬、錯題重練、完整解析與老師語音。
            </p>
            {false && packageAccess?.discountReward?.status === "available" && (
              <div className="medtech-paywall-wheel">
                <b>🎡 這一關可抽一次折扣，最高五折</b>
                <span>
                  完成前一關後，另可挑戰隨機 10 題，每題 5 秒，每包最多 2
                  次；抽完或放棄後，再以優惠價或原價購買。
                </span>
                <div>
                  <button
                    type="button"
                    onClick={() => void choosePackDiscount("spin")}
                    disabled={Boolean(discountAction)}
                  >
                    {discountAction === "spin" ? "抽取中…" : "抽一次折扣"}
                  </button>
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => void choosePackDiscount("abandon")}
                    disabled={Boolean(discountAction)}
                  >
                    {discountAction === "abandon"
                      ? "處理中…"
                      : "放棄，原價購買"}
                  </button>
                </div>
              </div>
            )}
            {false && packageAccess?.discountReward?.status === "revealed" && (
              <p className="medtech-paywall-result">
                已抽到{packageAccess.discountReward.label}：NT${"$"}
                {packageAccess.discountReward.cost}。
              </p>
            )}
            {false && packageAccess?.discountReward &&
              (packageAccess.discountReward.status === "revealed" ||
                packageAccess.discountReward.status === "abandoned") && (
                <button
                  type="button"
                  className="medtech-paywall-credit"
                  onClick={() => void unlockPackage()}
                  disabled={unlockingPackage}
                >
                  {unlockingPackage
                    ? "處理中…"
                    : `NT$${packageAccess.cost} 購買`}
                </button>
              )}
            <div>
              <button type="button" onClick={() => setPaywallOpen(false)}>
                稍後再說
              </button>
              <Link href="/medtech/pricing">
                查看並開通全庫方案
              </Link>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
