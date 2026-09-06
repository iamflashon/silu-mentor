"use client";

import { useEffect, useState } from "react";

type Artifact = { id: number; tool: string; topic: string; content: string; sourceLabel: string; reviewStatus: string; reuseCount: number; audioFileName?: string | null; updatedAt: string };
const labels: Record<string, string> = { guide: "完整讀書指南", quiz: "反過來考我", priority: "考前重點排序", explain: "概念拆解", gaps: "教材銜接缺口", mock: "完整模擬考", audio: "通勤語音摘要" };

export default function ArtifactManager() {
  const [rows, setRows] = useState<Artifact[]>([]);
  const [selected, setSelected] = useState<number[]>([]);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [draftContent, setDraftContent] = useState("");
  const [draftSourceLabel, setDraftSourceLabel] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    const response = await fetch("/api/admin/pengli-study-artifacts", { cache: "no-store" });
    const data = await response.json() as { rows?: Artifact[]; error?: string };
    if (response.ok) {
      const nextRows = data.rows || [];
      setRows(nextRows);
      setSelected((current) => current.filter((id) => nextRows.some((row) => row.id === id)));
    } else setNotice(data.error || "成果庫讀取失敗。");
  }
  useEffect(() => { void load(); }, []);
  useEffect(() => {
    const refresh = () => void load();
    window.addEventListener("pengli-artifact-generated", refresh);
    return () => window.removeEventListener("pengli-artifact-generated", refresh);
  }, []);

  function toggle(id: number) { setSelected((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]); }
  function beginEdit(row: Artifact) { setEditingId(row.id); setDraftContent(row.content); setDraftSourceLabel(row.sourceLabel || ""); setNotice(""); }

  async function mutate(action: "publish" | "unpublish", ids: number[]) {
    if (!ids.length || busy) return;
    setBusy(true); setNotice("正在更新發布狀態…");
    const response = await fetch("/api/admin/pengli-study-artifacts", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ ids, action }) });
    const data = await response.json() as { error?: string; updatedCount?: number };
    setNotice(response.ok ? `${data.updatedCount || ids.length} 筆成果${action === "publish" ? "已發布到學生前台" : "已下架"}。` : data.error || "更新失敗。");
    if (response.ok) { setSelected([]); await load(); window.dispatchEvent(new Event("pengli-artifacts-updated")); }
    setBusy(false);
  }

  async function saveEdit() {
    if (!editingId || !draftContent.trim() || busy) return;
    setBusy(true); setNotice("正在儲存修改…");
    const response = await fetch("/api/admin/pengli-study-artifacts", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: editingId, action: "edit", content: draftContent, sourceLabel: draftSourceLabel }) });
    const data = await response.json() as { error?: string };
    setNotice(response.ok ? "內容已儲存；若原本已發布，學生前台會同步顯示最新版。" : data.error || "儲存失敗。");
    if (response.ok) { setEditingId(null); await load(); window.dispatchEvent(new Event("pengli-artifacts-updated")); }
    setBusy(false);
  }

  async function removeSelected() {
    if (!selected.length || busy || !window.confirm(`確定永久刪除所選的 ${selected.length} 筆成果？學生前台也會立即移除，且無法復原。`)) return;
    setBusy(true); setNotice("正在刪除所選成果…");
    const response = await fetch("/api/admin/pengli-study-artifacts", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ ids: selected }) });
    const data = await response.json() as { error?: string; deletedCount?: number };
    setNotice(response.ok ? `已刪除 ${data.deletedCount || selected.length} 筆成果。` : data.error || "刪除失敗。");
    if (response.ok) { setSelected([]); setEditingId(null); await load(); window.dispatchEvent(new Event("pengli-artifacts-updated")); }
    setBusy(false);
  }

  async function uploadAudio(id: number, file?: File) {
    if (!file || busy) return;
    setBusy(true); setNotice("正在上傳完成的語音檔…");
    const form = new FormData(); form.set("id", String(id)); form.set("file", file);
    const response = await fetch("/api/admin/pengli-study-artifacts/audio", { method: "POST", body: form });
    const data = await response.json() as { error?: string };
    setNotice(response.ok ? "語音成品已上傳；發布後學生會直接看到播放器。" : data.error || "音檔上傳失敗。");
    if (response.ok) await load();
    setBusy(false);
  }

  async function copyScript(content: string) {
    await navigator.clipboard.writeText(content);
    setNotice("語音稿已複製，可直接貼到語音生成工具製作成品。");
  }

  const allSelected = rows.length > 0 && selected.length === rows.length;
  return <section className="artifact-manager">
    <header><div><span>PUBLISHING</span><h2>成果發布管理</h2><p>可先編輯審稿，再單筆或批次發布；已發布內容才會出現在學生端。</p></div><button onClick={() => void load()} disabled={busy}>重新整理</button></header>
    {notice && <p className="artifact-notice" aria-live="polite">{notice}</p>}
    {rows.length > 0 && <div className="artifact-toolbar"><label><input type="checkbox" checked={allSelected} onChange={() => setSelected(allSelected ? [] : rows.map((row) => row.id))} /> 全選</label><span>已選 {selected.length} 筆</span><div><button onClick={() => void mutate("publish", selected)} disabled={!selected.length || busy}>一鍵發布所選</button><button className="secondary" onClick={() => void mutate("unpublish", selected)} disabled={!selected.length || busy}>下架所選</button><button className="danger" onClick={() => void removeSelected()} disabled={!selected.length || busy}>刪除所選</button></div></div>}
    <div className="artifact-list">{rows.length ? rows.map((row) => <article key={row.id} className={selected.includes(row.id) ? "selected" : ""}>
      <label className="artifact-select"><input type="checkbox" checked={selected.includes(row.id)} onChange={() => toggle(row.id)} /><span className="sr-only">選取 {row.topic}</span></label>
      <div className="artifact-body"><small>{labels[row.tool] || row.tool}</small><h3>{row.topic}</h3>{editingId === row.id ? <div className="artifact-editor"><label>內容<textarea rows={14} value={draftContent} onChange={(event) => setDraftContent(event.target.value)} /></label><label>教材來源註記<input value={draftSourceLabel} onChange={(event) => setDraftSourceLabel(event.target.value)} /></label><div><button onClick={() => void saveEdit()} disabled={!draftContent.trim() || busy}>儲存修改</button><button className="secondary" onClick={() => setEditingId(null)} disabled={busy}>取消</button></div></div> : <><p>{row.content.slice(0, 180)}{row.content.length > 180 ? "…" : ""}</p><em>共用 {row.reuseCount} 次</em>{row.tool === "audio" && <div className="artifact-audio-tools"><button className="secondary" onClick={() => void copyScript(row.content)}>複製語音稿</button><label className="audio-upload">{row.audioFileName ? `更換音檔：${row.audioFileName}` : "上傳語音成品"}<input type="file" accept="audio/mpeg,audio/mp4,audio/wav,audio/ogg,audio/aac,audio/webm,.mp3,.m4a,.wav,.ogg,.aac,.webm" onChange={(event) => void uploadAudio(row.id, event.target.files?.[0])} disabled={busy} /></label></div>}</>}</div>
      <div className="artifact-actions"><b className={row.reviewStatus === "published" ? "published" : "pending"}>{row.reviewStatus === "published" ? "已發布" : "待審核"}</b><button className="secondary" onClick={() => beginEdit(row)} disabled={busy || editingId === row.id}>編輯</button><button onClick={() => void mutate(row.reviewStatus === "published" ? "unpublish" : "publish", [row.id])} disabled={busy}>{row.reviewStatus === "published" ? "下架" : "發布到前台"}</button></div>
    </article>) : <p>尚無可管理的學習成果；請先在下方產生內容。</p>}</div>
  </section>;
}
