"use client";

import { useLayoutEffect } from "react";
import AccountingCoach from "./AccountingCoach";

export default function AccountingHomeClient() {
  useLayoutEffect(() => {
    // iOS can restore the old position after React has mounted, and a saved
    // #accounting-coach hash can trigger a second jump. Clear both unless the
    // visitor explicitly presses the CTA on this render.
    if (!window.matchMedia("(max-width: 800px)").matches) return;
    const previous = window.history.scrollRestoration;
    window.history.scrollRestoration = "manual";
    if (window.location.hash) window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
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

  function startAccountingQuestion() {
    const coach = document.getElementById("accounting-coach");
    if (!coach) return;
    window.history.replaceState(null, "", "#accounting-coach");
    coach.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return <main className="accounting-home accounting-qa-page">
    <header className="accounting-top">
      <div className="accounting-brand"><span>中</span><div><b>中級會計課業答疑</b><small>INTERNAL TEST</small></div></div>
    </header>
    <section className="accounting-hero accounting-help-hero"><div><span>中級會計學 · Luna 助教</span><h1>有哪裡不懂，<br/>直接問就好</h1><p>觀念、準則、計算、分錄或老師上課沒聽懂的地方，都能打字、貼截圖或拍照提問。</p><div><button type="button" onClick={startAccountingQuestion}>開始問 Luna 助教</button></div></div></section>
    <AccountingCoach canAdmin={false} apiEndpoint="/api/accounting/qa-tutor" trialMode />
  </main>;
}
