"use client";

import { useLayoutEffect, useState } from "react";
import AccountingCoach from "./AccountingCoach";

export default function AccountingHomeClient() {
  const [studyEntry, setStudyEntry] = useState({ mode: "", chapter: "", prompt: "" });
  useLayoutEffect(() => {
    // iOS can restore the old position after React has mounted, and a saved
    // #accounting-coach hash can trigger a second jump. Clear both unless the
    // visitor explicitly presses the CTA on this render.
    if (!window.matchMedia("(max-width: 800px)").matches) return;
    const previous = window.history.scrollRestoration;
    window.history.scrollRestoration = "manual";
    if (window.location.hash)
      window.history.replaceState(
        null,
        "",
        `${window.location.pathname}${window.location.search}`,
      );
    const reset = () => window.scrollTo(0, 0);
    reset();
    const frame = window.requestAnimationFrame(reset);
    const afterPaint = window.setTimeout(reset, 120);
    const afterRestore = window.setTimeout(reset, 500);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(afterPaint);
      window.clearTimeout(afterRestore);
      window.history.scrollRestoration = previous;
    };
  }, []);

  useLayoutEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const mode = params.get("mode") || "";
    const chapter = params.get("chapter") || "";
    if (!chapter) return;
    const prompt = mode === "review"
      ? `請只依《中級會計學霸》「${chapter}」整理考前速讀重點：核心觀念、必記公式、計算順序與最容易失分的地方，並標示實際教材來源。`
      : mode === "teachback"
        ? `我想用自己的話說明《中級會計學霸》「${chapter}」。請先不要直接講答案，等我說明後，再指出我說錯、遺漏或過度簡化的地方，並依教材來源修正。\n\n我的說明：`
        : `請只依《中級會計學霸》「${chapter}」帶我學習。先整理本章核心觀念、公式與常考題型，再讓我選擇要深入的部分，並標示實際教材來源。`;
    setStudyEntry({ mode, chapter, prompt });
  }, []);

  function startAccountingQuestion() {
    const coach = document.getElementById("accounting-coach");
    if (!coach) return;
    window.history.replaceState(null, "", "#accounting-coach");
    coach.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <main className="accounting-home accounting-qa-page">
      <header className="accounting-top">
        <div className="accounting-brand">
          <span>中</span>
          <div>
            <b>中級會計課業答疑</b>
            <small>ACCOUNTING AI TUTOR</small>
          </div>
        </div>
        <nav>
          <a href="/accounting">回會計首頁</a>
        </nav>
      </header>
      <section className="accounting-hero accounting-help-hero">
        <div>
          <span>{studyEntry.chapter ? `學霸讀書室 · ${studyEntry.chapter}` : "中級會計學 · Luna 助教"}</span>
          <h1>
            {studyEntry.mode === "review" ? <>先抓住重點，<br/>再回題目驗證</> : studyEntry.mode === "teachback" ? <>你先說給我聽，<br/>再一起找缺口</> : studyEntry.chapter ? <>先讀懂這一章，<br/>再開始練題</> : <>有哪裡不懂，<br/>直接問就好</>}
          </h1>
          <p>
            觀念、準則、計算、分錄或老師上課沒聽懂的地方，都能打字、貼截圖或拍照提問。
          </p>
          <div>
            <button type="button" onClick={startAccountingQuestion}>
              開始問 Luna 助教
            </button>
          </div>
        </div>
      </section>
      <AccountingCoach canAdmin={false} apiEndpoint="/api/accounting/tutor" initialQuestion={studyEntry.prompt} />
    </main>
  );
}
