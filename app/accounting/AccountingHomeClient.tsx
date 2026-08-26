"use client";

import { useEffect, useLayoutEffect, useState } from "react";
import AccountingCoach from "./AccountingCoach";

export default function AccountingHomeClient({ canAdmin }: { canAdmin: boolean }) {
  const [studentPreview, setStudentPreview] = useState(false);

  useEffect(() => {
    if (canAdmin) setStudentPreview(window.localStorage.getItem("accounting-student-preview") === "1");
  }, [canAdmin]);

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

  function switchMode(preview: boolean) {
    setStudentPreview(preview);
    window.localStorage.setItem("accounting-student-preview", preview ? "1" : "0");
  }

  const adminMode = canAdmin && !studentPreview;
  return <main className="accounting-home">
    <header className="accounting-top">
      <a href="/accounting" className="accounting-brand"><span>中</span><div><b>中級會計課業答疑</b><small>INTERMEDIATE ACCOUNTING</small></div></a>
      <nav>
        <a className="active" href="/accounting">課業答疑</a>
        <a href="/accounting/books">練題書庫</a>
        {adminMode && <a href="/accounting/admin">管理後台</a>}
        {canAdmin && (studentPreview
          ? <button type="button" className="accounting-mode-switch return" onClick={() => switchMode(false)}>返回管理模式</button>
          : <button type="button" className="accounting-mode-switch" onClick={() => switchMode(true)}>切換學生預覽</button>)}
      </nav>
    </header>
    {canAdmin && studentPreview && <div className="accounting-preview-notice"><span>學生預覽模式</span><p>目前看到的是一般學生畫面，管理後台與測試功能已隱藏。</p><button type="button" onClick={() => switchMode(false)}>返回管理模式</button></div>}
    <section className="accounting-hero accounting-help-hero"><div><span>中級會計學 · Luna 助教</span><h1>有哪裡不懂，<br/>直接問就好</h1><p>觀念、準則、計算、分錄或老師上課沒聽懂的地方，都能打字、貼截圖或拍照提問。</p><div><button type="button" onClick={startAccountingQuestion}>開始問 Luna 助教</button></div></div></section>
    <AccountingCoach canAdmin={adminMode} />
  </main>;
}
