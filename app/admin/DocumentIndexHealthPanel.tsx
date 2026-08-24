"use client";

import { useMemo, useRef, useState } from "react";

type HealthStatus = "healthy" | "repair_fine" | "repair_full" | "reocr" | "missing_source" | "processing" | "unsupported";
type HealthItem = { id: number; fileName: string; bookTitle: string; examCategory: string; subject: string; documentType: string; pageCount: number | null; extractedChars: number; fullTextIndexed: boolean; vectorIndexed: boolean; sourceExists: boolean; fineSearchUnitCount: number; indexedPages: number; indexedTextChars: number; healthStatus: HealthStatus; healthReason: string; repairable: boolean };
type HealthPayload = { scannedAt: string; total: number; summary: Partial<Record<HealthStatus, number>>; items: HealthItem[]; error?: string };
type HealthBatch = { scannedAt?: string; total?: number; nextOffset?: number; done?: boolean; items?: HealthItem[]; error?: string };

const labels: Record<HealthStatus, string> = { healthy: "正常", repair_fine: "可補頁面索引", repair_full: "需補全文／向量", reocr: "建議重新 OCR", missing_source: "缺原始檔", processing: "處理中", unsupported: "非教材格式" };
const REPAIR_BATCH_SIZE = 10;

export default function DocumentIndexHealthPanel() {
  const [data, setData] = useState<HealthPayload | null>(null);
  const [scanning, setScanning] = useState(false);
  const [repairing, setRepairing] = useState(false);
  const [selected, setSelected] = useState<number[]>([]);
  const [filter, setFilter] = useState<HealthStatus | "all">("all");
  const [progress, setProgress] = useState<string[]>([]);
  const [scanProgress, setScanProgress] = useState({ done: 0, total: 0 });
  const [skippedIds, setSkippedIds] = useState<number[]>([]);
  const stopRef = useRef(false);
  const visible = useMemo(() => (data?.items ?? []).filter((item) => filter === "all" || item.healthStatus === filter), [data, filter]);
  const selectedRepairableCount = useMemo(() => (data?.items ?? []).filter((item) => selected.includes(item.id) && item.repairable).length, [data, selected]);

  async function scan(preserveProgress = false, excluded = new Set<number>()) {
    setScanning(true); setScanProgress({ done: 0, total: 0 }); if (!preserveProgress) setProgress([]);
    if (!preserveProgress) setSkippedIds([]);
    try {
      let offset = 0;
      let total = 0;
      let scannedAt = new Date().toISOString();
      const items: HealthItem[] = [];
      for (let batch = 0; batch < 1000; batch += 1) {
        const response = await fetch(`/api/admin/document-index-health?offset=${offset}&limit=12`, { cache: "no-store" });
        const raw = await response.text();
        let chunk: HealthBatch;
        try { chunk = raw ? JSON.parse(raw) as HealthBatch : {}; }
        catch { throw new Error("伺服器回傳內容不完整，請稍後重新掃描"); }
        if (!response.ok) throw new Error(chunk.error || `健檢服務暫時無法讀取（${response.status}）`);
        total = Number(chunk.total || total);
        scannedAt = chunk.scannedAt || scannedAt;
        items.push(...(chunk.items || []));
        offset = Number(chunk.nextOffset ?? items.length);
        setScanProgress({ done: items.length, total });
        if (chunk.done || !chunk.items?.length) break;
        await new Promise((resolve) => window.setTimeout(resolve, 80));
      }
      const summary = items.reduce((result, item) => { result[item.healthStatus] = (result[item.healthStatus] || 0) + 1; return result; }, {} as Partial<Record<HealthStatus, number>>);
      const payload: HealthPayload = { scannedAt, total, summary, items };
      setData(payload); setSelected(payload.items.filter((item) => item.repairable && !excluded.has(item.id)).map((item) => item.id));
    } catch (error) { setProgress([error instanceof Error ? error.message : "索引健檢失敗"]); }
    finally { setScanning(false); }
  }

  async function repairFine(item: HealthItem) {
    let restart = true;
    for (let attempt = 0; attempt < 500; attempt += 1) {
      const response = await fetch("/api/documents/fine-index", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ documentId: item.id, restart }) });
      const result = await response.json() as { done?: boolean; pagesDone?: number; totalPages?: number; error?: string };
      if (!response.ok) throw new Error(result.error || "頁面索引修復失敗");
      restart = false;
      setProgress((rows) => [...rows.slice(0, -1), `${item.bookTitle || item.fileName}：${result.pagesDone || 0}/${result.totalPages || 0} 頁`]);
      if (result.done) return;
      await new Promise((resolve) => window.setTimeout(resolve, 120));
    }
    throw new Error("頁面索引處理逾時，已保存目前進度");
  }

  async function repairFull(item: HealthItem) {
    for (let attempt = 0; attempt < 120; attempt += 1) {
      const response = await fetch("/api/documents/process", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ documentId: item.id, retry: attempt === 0 }) });
      const result = await response.json() as { status?: string; message?: string; error?: string };
      if (!response.ok && response.status !== 202) throw new Error(result.error || "全文／向量索引修復失敗");
      setProgress((rows) => [...rows.slice(0, -1), `${item.bookTitle || item.fileName}：${result.message || "索引處理中"}`]);
      if (result.status === "completed") return;
      if (result.status === "failed") throw new Error(result.error || "全文／向量索引修復失敗");
      await new Promise((resolve) => window.setTimeout(resolve, 1500));
    }
    throw new Error("全文／向量處理時間較長，已保存目前進度");
  }

  async function repairSelected() {
    if (!data || repairing) return;
    const targets = data.items.filter((item) => selected.includes(item.id) && item.repairable).slice(0, REPAIR_BATCH_SIZE);
    if (!targets.length) { setProgress(["目前沒有選取可自動修復的教材。"]); return; }
    setRepairing(true); stopRef.current = false; setProgress([]);
    let completed = 0;
    const attemptedIds: number[] = [];
    for (const [index, item] of targets.entries()) {
      if (stopRef.current) break;
      attemptedIds.push(item.id);
      setProgress((rows) => [...rows, `${index + 1}/${targets.length} ${item.bookTitle || item.fileName}：開始處理…`]);
      try {
        if (item.healthStatus === "repair_full") { await repairFull(item); await repairFine(item); }
        else await repairFine(item);
        completed += 1;
        setProgress((rows) => [...rows, `✓ ${item.bookTitle || item.fileName}：修復完成`]);
      } catch (error) { setProgress((rows) => [...rows, `✕ ${item.bookTitle || item.fileName}：${error instanceof Error ? error.message : "修復失敗"}`]); }
    }
    const nextSkipped = [...new Set([...skippedIds, ...attemptedIds])];
    setSkippedIds(nextSkipped);
    setProgress((rows) => [...rows, stopRef.current ? `已安全停止；完成 ${completed}/${attemptedIds.length} 份，本輪已略過 ${attemptedIds.length - completed} 份。` : `批次修復完成：${completed}/${attemptedIds.length} 份；未成功項目本輪先略過，不會立即重複。`]);
    setRepairing(false); await scan(true, new Set(nextSkipped));
  }

  const statuses: HealthStatus[] = ["healthy", "repair_fine", "repair_full", "reocr", "missing_source", "processing", "unsupported"];
  return <section className="panel index-health-panel">
    <header><div><p>INDEX HEALTH & REPAIR</p><h2>批次索引健檢與修復</h2><span>先檢查全部教材；修復完成前保留既有可用索引，只對可安全處理的項目接續補建。</span></div><button className="primary-btn" onClick={() => void scan()} disabled={scanning || repairing}>{scanning ? `掃描中 ${scanProgress.done}${scanProgress.total ? ` / ${scanProgress.total}` : ""}…` : data ? "重新掃描全部教材" : "掃描全部教材"}</button></header>
    {data && <><div className="index-health-summary"><button className={filter === "all" ? "active" : ""} onClick={() => setFilter("all")}><span>全部教材</span><strong>{data.total}</strong></button>{statuses.map((status) => <button key={status} className={`${filter === status ? "active" : ""} health-${status}`} onClick={() => setFilter(status)}><span>{labels[status]}</span><strong>{data.summary[status] || 0}</strong></button>)}</div>
      <div className="index-health-toolbar"><label><input type="checkbox" checked={visible.filter((item) => item.repairable && !skippedIds.includes(item.id)).length > 0 && visible.filter((item) => item.repairable && !skippedIds.includes(item.id)).every((item) => selected.includes(item.id))} onChange={(event) => { const ids = visible.filter((item) => item.repairable && !skippedIds.includes(item.id)).map((item) => item.id); setSelected((current) => event.target.checked ? [...new Set([...current, ...ids])] : current.filter((id) => !ids.includes(id))); }} />選取目前可修復項目</label><div className="index-health-actions"><small>每次最多處理 {REPAIR_BATCH_SIZE} 份；本輪嘗試後即移往下一批{skippedIds.length ? `，已處理／略過 ${skippedIds.length} 份` : ""}。</small><button onClick={() => void repairSelected()} disabled={repairing || !selectedRepairableCount}>{repairing ? "本批修復中…" : `修復下一批（${Math.min(REPAIR_BATCH_SIZE, selectedRepairableCount)} / 本輪剩餘 ${selectedRepairableCount}）`}</button>{repairing && <button className="secondary" onClick={() => { stopRef.current = true; }}>完成目前教材後停止</button>}</div></div>
      <div className="index-health-list">{visible.map((item) => <article key={item.id} className={`health-${item.healthStatus}`}><input type="checkbox" disabled={!item.repairable || repairing} checked={selected.includes(item.id)} onChange={(event) => setSelected((current) => event.target.checked ? [...current, item.id] : current.filter((id) => id !== item.id))} /><div><strong>{item.bookTitle || item.fileName}</strong><small>{item.subject} · {item.pageCount ? `${item.pageCount} 頁` : "頁數待確認"} · {item.fineSearchUnitCount} 個頁面片段</small><span>{item.healthReason}</span></div><b>{labels[item.healthStatus]}</b></article>)}</div>
    </>}
    {!!progress.length && <div className="index-health-progress" aria-live="polite">{progress.slice(-12).map((line, index) => <span key={`${line}-${index}`}>{line}</span>)}</div>}
    {!data && !scanning && <p className="index-health-empty">尚未執行健檢。掃描只會讀取狀態，不會修改教材。</p>}
  </section>;
}
