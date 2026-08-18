"use client";

import { useState } from "react";

type Props = { href: string; packNumber: number; questionTotal: number; label: string; remaining?: string };

const modes = [
  { key: "ordered", title: "1. 順序出題", description: "依照題目包原本的題號順序作答。", params: "questionOrder=ordered&optionOrder=ordered" },
  { key: "random", title: "2. 隨機出題", description: "題號順序重新打亂，選項維持 A～D。", params: "questionOrder=random&optionOrder=ordered" },
  { key: "options", title: "3. 隨機選項", description: "題號依原本順序，A～D 選項重新排列。", params: "questionOrder=ordered&optionOrder=random" },
] as const;

export default function MedtechRetakeOptions({ href, packNumber, questionTotal, label, remaining }: Props) {
  const [open, setOpen] = useState(false);
  const withMode = (params: string) => `${href}${href.includes("?") ? "&" : "?"}${params}`;

  return <>
    <button type="button" className="medtech-pack-retake-trigger" onClick={() => setOpen(true)} aria-haspopup="dialog">
      <span>第 {packNumber} 關</span>
      <b>{questionTotal} 題</b>
      <small>{label}{remaining ? ` · ${remaining}` : ""}</small>
      <strong>再次挑戰 →</strong>
    </button>
    {open && <div className="medtech-retake-backdrop" role="presentation" onMouseDown={() => setOpen(false)}>
      <section className="medtech-retake-dialog" role="dialog" aria-modal="true" aria-labelledby="medtech-retake-title" onMouseDown={(event) => event.stopPropagation()}>
        <button type="button" className="medtech-retake-close" onClick={() => setOpen(false)} aria-label="關閉">×</button>
        <span>再次挑戰</span>
        <h2 id="medtech-retake-title">選擇出題方式</h2>
        <p>重新作答前先選擇順序；每一回的作答紀錄會獨立保存。</p>
        <div className="medtech-retake-options">
          {modes.map((mode) => <a key={mode.key} href={withMode(mode.params)} onClick={() => setOpen(false)}><b>{mode.title}</b><span>{mode.description}</span><strong>開始挑戰 →</strong></a>)}
        </div>
      </section>
    </div>}
  </>;
}
