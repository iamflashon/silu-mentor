"use client";

import { useRef, useState } from "react";

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
  const voiceZipInput = useRef<HTMLInputElement>(null);

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

  async function uploadVoiceZip(file: File) {
    if (file.size > 360 * 1024 * 1024) {
      await onDone("語音包 ZIP 不可超過 360MB。");
      return;
    }
    setBusy(true);
    const form = new FormData();
    form.set("documentId", String(documentId));
    form.set("zip", file, file.name);
    try {
      const response = await fetch("/api/medtech/admin/audio-import", { method: "POST", body: form });
      const data = await response.json() as { error?: string; matched?: number; audioPairs?: number; subtitlePairs?: number; unmatched?: Array<unknown>; invalid?: Array<unknown> };
      if (!response.ok) {
        await onDone(data.error || "語音包匯入失敗。");
        return;
      }
      const unmatched = data.unmatched?.length ? `，未配對 ${data.unmatched.length} 個` : "";
      const invalid = data.invalid?.length ? `，格式問題 ${data.invalid.length} 個` : "";
      await onDone(`語音包匯入完成：配對 ${data.matched ?? 0} 題，音檔 ${data.audioPairs ?? 0} 個，SRT ${data.subtitlePairs ?? 0} 個${unmatched}${invalid}`);
    } catch {
      await onDone("語音包匯入失敗，請確認 ZIP 未加密且檔名包含 q題目ID。");
    } finally {
      setBusy(false);
      if (voiceZipInput.current) voiceZipInput.current.value = "";
    }
  }

  return <><button type="button" className="repair-missing-button" disabled={disabled || busy} onClick={() => void repair()}>{busy ? "處理中…" : "補齊原稿缺題"}</button><label className="workspace-zip-upload"><input ref={voiceZipInput} hidden type="file" accept=".zip" disabled={disabled || busy} onChange={event => { const file = event.target.files?.[0]; if (file) void uploadVoiceZip(file); }} />上傳語音包 ZIP</label></>;
}
