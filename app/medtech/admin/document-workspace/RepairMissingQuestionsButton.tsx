"use client";

import { useState } from "react";

export function RepairMissingQuestionsButton({
  documentId,
  disabled,
  onDone,
}: {
  documentId: number;
  disabled?: boolean;
  onDone: (message: string) => void | Promise<void>;
}) {
  const [busy, setBusy] = useState(false);

  async function repair() {
    if (!confirm("系統會重新讀取這份原始 PDF，只新增原稿有但題庫缺少的題目，既有題目、解析與語音資料都會保留。確定補齊？")) return;
    setBusy(true);
    try {
      const response = await fetch("/api/medtech/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ documentId, repairMissing: true, forceReparse: true }),
      });
      const data = await response.json() as { error?: string; imported?: number; parsed?: number };
      if (!response.ok) {
        await onDone(data.error || "原稿比對失敗，既有題庫未變更。");
        return;
      }
      await onDone(data.imported ? `已補齊 ${data.imported} 題，目前共 ${data.parsed ?? ""} 題。` : `比對完成，目前共 ${data.parsed ?? ""} 題，沒有新增缺題。`);
    } catch {
      await onDone("原稿比對失敗，既有題庫未變更。");
    } finally {
      setBusy(false);
    }
  }

  return <button type="button" className="repair-missing-button" disabled={disabled || busy} onClick={() => void repair()}>{busy ? "比對中…" : "補齊原稿缺題"}</button>;
}
