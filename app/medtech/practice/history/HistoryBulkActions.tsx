"use client";

import { useRef, useState, type ChangeEvent, type ReactNode } from "react";

export default function HistoryBulkActions({
  sessionIds,
  children,
}: {
  sessionIds: number[];
  children: ReactNode;
}) {
  const [selected, setSelected] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const allSelected =
    sessionIds.length > 0 && selected.length === sessionIds.length;

  function onChange(event: ChangeEvent<HTMLDivElement>) {
    const target = event.target as HTMLInputElement;
    const sessionId = Number(target.dataset.historySession);
    if (!sessionId) return;
    setSelected((current) =>
      target.checked
        ? [...new Set([...current, sessionId])]
        : current.filter((id) => id !== sessionId),
    );
  }

  function toggleAll() {
    setSelected(allSelected ? [] : sessionIds);
    containerRef.current
      ?.querySelectorAll<HTMLInputElement>("input[data-history-session]")
      .forEach((checkbox) => {
        checkbox.checked = !allSelected;
      });
  }

  async function deleteSelected() {
    if (!selected.length || busy) return;
    if (
      !window.confirm(
        `確定刪除選取的 ${selected.length} 筆學習紀錄？刪除後無法恢復；已購題目包與錯題複習資料不受影響。`,
      )
    )
      return;
    setBusy(true);
    try {
      const response = await fetch("/api/medtech/practice/history", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionIds: selected }),
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(result.error || "刪除學習紀錄失敗");
      window.location.reload();
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "刪除學習紀錄失敗");
      setBusy(false);
    }
  }

  return (
    <div
      className="medtech-history-bulk"
      ref={containerRef}
      onChange={onChange}
    >
      <div className="medtech-history-bulk-toolbar">
        <button type="button" onClick={toggleAll} disabled={!sessionIds.length}>
          {allSelected ? "取消全選" : "全選本頁"}
        </button>
        <span>
          {selected.length ? `已選 ${selected.length} 筆` : "可勾選多筆紀錄"}
        </span>
        <button
          type="button"
          className="danger"
          onClick={() => void deleteSelected()}
          disabled={!selected.length || busy}
          aria-busy={busy}
        >
          {busy ? "刪除中…" : "刪除選取紀錄"}
        </button>
      </div>
      {children}
    </div>
  );
}
