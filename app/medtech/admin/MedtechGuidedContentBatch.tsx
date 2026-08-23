"use client";

import { useEffect, useRef, useState } from "react";

type PendingQuestion = { id: number; year: string; subject: string; questionNumber: string; stem: string };
type GuidedStatus = { published?: number; eligible?: number; unavailable?: number; ready?: number; pending?: PendingQuestion[]; error?: string };

export default function MedtechGuidedContentBatch() {
  const [published, setPublished] = useState(0);
  const [eligible, setEligible] = useState(0);
  const [unavailable, setUnavailable] = useState(0);
  const [ready, setReady] = useState(0);
  const [pending, setPending] = useState<PendingQuestion[]>([]);
  const [busy, setBusy] = useState(false);
  const [continuous, setContinuous] = useState(false);
  const [notice, setNotice] = useState("");
  const stopRequested = useRef(false);

  async function load() {
    const response = await fetch("/api/medtech/admin/guided-content", { cache: "no-store" });
    const data = await response.json() as GuidedStatus;
    if (!response.ok) throw new Error(data.error || "引導內容狀態讀取失敗");
    setPublished(data.published || 0); setEligible(data.eligible || 0); setUnavailable(data.unavailable || 0); setReady(data.ready || 0); setPending(data.pending || []);
    return data;
  }

  useEffect(() => { void load().catch((error) => setNotice(error instanceof Error ? error.message : "引導內容狀態讀取失敗")); }, []);

  async function generate(question: PendingQuestion, force = false) {
    const response = await fetch("/api/medtech/admin/guided-content", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: question.id, force }) });
    const raw = await response.text();
    let data: { error?: string; skipped?: boolean } = {};
    try { data = raw ? JSON.parse(raw) as typeof data : {}; } catch { /* use HTTP fallback */ }
    if (!response.ok) throw new Error(data.error || `產生服務回應異常（HTTP ${response.status}）`);
  }

  async function generateBatch() {
    const targets = pending.slice(0, 10);
    if (!targets.length) return;
    if (!confirm(`將依序產生 ${targets.length} 題的判斷提示與四選項比較，並直接寫入資料庫。確定開始？`)) return;
    setBusy(true); let success = 0; let failed = 0; let firstError = "";
    for (const question of targets) {
      setNotice(`正在產生 ${success + failed + 1}/${targets.length}：第 ${question.questionNumber} 題`);
      try { await generate(question); success += 1; } catch (error) { failed += 1; if (!firstError) firstError = error instanceof Error ? error.message : "產生失敗"; }
    }
    setBusy(false); setNotice(`本批完成：成功 ${success} 題${failed ? `，失敗 ${failed} 題（${firstError}）` : ""}。`); await load();
  }

  async function generateContinuously() {
    if (!confirm("系統會每批處理 10 題並自動繼續。請保持本頁開啟；可隨時按「暫停」。確定開始？")) return;
    stopRequested.current = false;
    setBusy(true);
    setContinuous(true);
    let completed = 0;
    try {
      while (!stopRequested.current) {
        const status = await load();
        const targets = (status.pending || []).slice(0, 10);
        if (!targets.length) {
          setNotice(`全部可產生題目已完成；本次共新增 ${completed} 題。`);
          break;
        }
        for (const question of targets) {
          if (stopRequested.current) break;
          setNotice(`自動產生中：本次已完成 ${completed} 題；目前處理第 ${question.questionNumber} 題…`);
          try {
            await generate(question);
            completed += 1;
          } catch (error) {
            stopRequested.current = true;
            throw error;
          }
        }
      }
      if (stopRequested.current) setNotice((current) => current.includes("失敗") ? current : `已暫停；本次完成 ${completed} 題，可稍後繼續。`);
    } catch (error) {
      setNotice(`自動產生已停止：本次完成 ${completed} 題；${error instanceof Error ? error.message : "產生失敗"}`);
    } finally {
      setBusy(false);
      setContinuous(false);
      await load().catch(() => undefined);
    }
  }

  return <section className="medtech-admin-panel">
    <h2>引導學習預先產生</h2>
    <p className="medtech-admin-help">AI 僅在後台產生一次並存入資料庫。學生取得提示或比較選項時直接讀取，不會即時呼叫 AI。</p>
    <div className="simulation-accuracy-summary"><span>公開題目 <b>{published}</b></span><span>資料完整、可產生 <b>{eligible}</b></span><span>已完成 <b>{ready}</b></span><span>待產生 <b>{Math.max(0, eligible - ready)}</b></span><span>缺答案或選項 <b>{unavailable}</b></span></div>
    <div className="medtech-commercial-actions"><button type="button" className="medtech-save-product-button" disabled={busy || !pending.length} onClick={() => void generateBatch()}>{busy && !continuous ? "AI 批次產生中…" : pending.length ? `產生下一批 ${Math.min(10, pending.length)} 題` : "全部引導內容已完成"}</button><button type="button" className="medtech-save-product-button" disabled={busy || !pending.length} onClick={() => void generateContinuously()}>自動連續產生</button>{continuous&&<button type="button" onClick={() => { stopRequested.current = true; setNotice("收到暫停要求；目前題目完成後停止…"); }}>暫停</button>}<button type="button" disabled={busy} onClick={() => void load()}>重新整理</button></div>
    {notice && <p className="medtech-admin-notice">{notice}</p>}
    <div className="explanation-question-list">{pending.map((question) => <article key={question.id}><div><b>{question.subject} · {question.year} · 第 {question.questionNumber} 題</b><small>q{question.id} · {question.stem.replace(/<[^>]+>/g, " ").slice(0, 150)}</small></div><button type="button" disabled={busy} onClick={async () => { setBusy(true); setNotice(`正在產生第 ${question.questionNumber} 題…`); try { await generate(question, true); setNotice("本題提示與比較選項已寫入資料庫。"); await load(); } catch (error) { setNotice(error instanceof Error ? error.message : "產生失敗"); } finally { setBusy(false); } }}>產生本題</button></article>)}</div>
  </section>;
}
