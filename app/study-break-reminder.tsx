"use client";

import { useEffect, useState } from "react";

const focusSeconds = 50 * 60;
const restSeconds = 10 * 60;
const idleResetMs = 10 * 60 * 1000;
const storageKey = "silu-study-break-v1";

type ReminderState = { activeSeconds: number; lastActivityAt: number; snoozeUntil: number };

function readState(): ReminderState {
  try {
    const saved = JSON.parse(sessionStorage.getItem(storageKey) ?? "{}") as Partial<ReminderState>;
    return {
      activeSeconds: Math.max(0, Number(saved.activeSeconds) || 0),
      lastActivityAt: Number(saved.lastActivityAt) || Date.now(),
      snoozeUntil: Number(saved.snoozeUntil) || 0,
    };
  } catch {
    return { activeSeconds: 0, lastActivityAt: Date.now(), snoozeUntil: 0 };
  }
}

export default function StudyBreakReminder() {
  const [ready, setReady] = useState(false);
  const [activeSeconds, setActiveSeconds] = useState(0);
  const [lastActivityAt, setLastActivityAt] = useState(Date.now());
  const [snoozeUntil, setSnoozeUntil] = useState(0);
  const [restLeft, setRestLeft] = useState<number | null>(null);

  useEffect(() => {
    const saved = readState();
    const wasAway = Date.now() - saved.lastActivityAt >= idleResetMs;
    setActiveSeconds(wasAway ? 0 : saved.activeSeconds);
    setLastActivityAt(Date.now());
    setSnoozeUntil(saved.snoozeUntil);
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    const markActive = () => setLastActivityAt(Date.now());
    const events: Array<keyof WindowEventMap> = ["pointerdown", "keydown", "scroll", "touchstart"];
    events.forEach((event) => window.addEventListener(event, markActive, { passive: true }));
    return () => events.forEach((event) => window.removeEventListener(event, markActive));
  }, [ready]);

  useEffect(() => {
    if (!ready) return;
    const timer = window.setInterval(() => {
      if (restLeft !== null || document.visibilityState !== "visible") return;
      const now = Date.now();
      if (now - lastActivityAt >= idleResetMs) {
        setActiveSeconds(0);
        setLastActivityAt(now);
        return;
      }
      setActiveSeconds((value) => value + 1);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [lastActivityAt, ready, restLeft]);

  useEffect(() => {
    if (!ready) return;
    sessionStorage.setItem(storageKey, JSON.stringify({ activeSeconds, lastActivityAt, snoozeUntil }));
  }, [activeSeconds, lastActivityAt, ready, snoozeUntil]);

  useEffect(() => {
    if (restLeft === null) return;
    if (restLeft <= 0) return;
    const timer = window.setTimeout(() => setRestLeft((value) => value === null ? null : Math.max(0, value - 1)), 1000);
    return () => window.clearTimeout(timer);
  }, [restLeft]);

  const reminderOpen = ready && activeSeconds >= focusSeconds && Date.now() >= snoozeUntil;
  if (!reminderOpen && restLeft === null) return null;

  const finishRest = () => {
    setRestLeft(null);
    setActiveSeconds(0);
    setSnoozeUntil(0);
    setLastActivityAt(Date.now());
  };
  const minutes = restLeft === null ? 0 : Math.floor(restLeft / 60);
  const seconds = restLeft === null ? 0 : restLeft % 60;

  return (
    <div className="study-break-overlay" role="dialog" aria-modal="true" aria-label="休息提醒">
      <section className="study-break-card">
        <span>{restLeft === null ? "50 MIN FOCUS" : "REST TIME"}</span>
        <div className="study-break-icon" aria-hidden="true">☕</div>
        {restLeft === null ? (
          <>
            <h2>你已經專心學習 50 分鐘了</h2>
            <p>讓眼睛離開螢幕、起身伸展一下。休息不是中斷，是讓下一段學習更有效。</p>
            <div className="study-break-actions">
              <button type="button" className="primary" onClick={() => setRestLeft(restSeconds)}>開始休息 10 分鐘</button>
              <button type="button" onClick={() => setSnoozeUntil(Date.now() + 10 * 60 * 1000)}>再用 10 分鐘提醒我</button>
            </div>
          </>
        ) : restLeft > 0 ? (
          <>
            <h2>休息一下，答案與進度都已保留</h2>
            <strong className="study-break-clock">{String(minutes).padStart(2, "0")}:{String(seconds).padStart(2, "0")}</strong>
            <p>看看遠方、喝口水，肩頸也放鬆一下。</p>
            <button type="button" onClick={finishRest}>我已休息，繼續學習</button>
          </>
        ) : (
          <>
            <h2>休息完成，可以繼續了</h2>
            <p>慢慢回來就好，下一段也記得保持舒服的姿勢。</p>
            <button type="button" className="primary" onClick={finishRest}>繼續學習</button>
          </>
        )}
      </section>
    </div>
  );
}
