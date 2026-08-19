"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export default function MedtechPracticeEntry() {
  const [open, setOpen] = useState(false);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", closeOnEscape);
    closeButtonRef.current?.focus();
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [open]);

  const choiceDialog = open ? createPortal(
    <div className="medtech-practice-choice-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) setOpen(false); }}>
      <section className="medtech-practice-choice" role="dialog" aria-modal="true" aria-labelledby="medtech-practice-choice-title">
        <header>
          <div><span>開始練題</span><h2 id="medtech-practice-choice-title">選擇練習方式</h2></div>
          <button ref={closeButtonRef} type="button" aria-label="關閉選擇視窗" onClick={() => setOpen(false)}>×</button>
        </header>
        <p>依照今天的目標，選擇章節練習或跨章節隨機模考。</p>
        <div className="medtech-practice-choice-options">
          <a href="/medtech/chapters" onClick={() => setOpen(false)}><b>按章節刷題</b><span>依臨床病毒學總論、DNA 病毒、RNA 病毒逐章練習</span><strong>進入章節刷題 →</strong></a>
          <a href="/medtech/random" onClick={() => setOpen(false)}><b>隨機模考</b><span>跨章節抽題，直接挑戰每 30 題一關的模考</span><strong>進入隨機模考 →</strong></a>
        </div>
      </section>
    </div>,
    document.body,
  ) : null;

  return <>
    <button type="button" className="medtech-free-practice-trigger" onClick={() => setOpen(true)}>開始免費練題（任選一包）</button>
    {choiceDialog}
  </>;
}
