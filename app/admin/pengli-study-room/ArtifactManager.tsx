"use client";

import { useEffect, useMemo, useState } from "react";

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
  const [toolFilter, setToolFilter] = useState("all"), [topicFilter, setTopicFilter] = useState("all"), [statusFilter, setStatusFilter] = useState("all");

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
    setNotice(response.ok ? "內容已儲存並改列待審核；確認後請重新發布。語音稿若有修改，需重新上傳對應音檔。" : data.error || "儲存失敗。");
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

  const topics = useMemo(() => [...new Set(rows.map((row) => row.topic))], [rows]);
  const filteredRows = useMemo(() => rows.filter((row) => (toolFilter === "all" || row.tool === toolFilter) && (topicFilter === "all" || row.topic === topicFilter) && (statusFilter === "all" || row.reviewStatus === statusFilter)), [rows, toolFilter, topicFilter, statusFilter]);
  const filteredIds = filteredRows.map((row) => row.id);
  const allSelected = filteredRows.length > 0 && filteredIds.every((id) => selected.includes(id));
  return <section className="artifact-manager">
    <header><div><span>PUBLISHING</span><h2>成果發布管理</h2><p>可先編輯審稿，再單筆或批次發布；已發布內容才會出現在學生端。</p></div><button onClick={() => void load()} disabled={busy}>重新整理</button></header>
    {notice && <p className="artifact-notice" aria-live="polite">{notice}</p>}
    {rows.length > 0 && <div className="artifact-filters"><div className="artifact-type-tabs"><button className={toolFilter === "all" ? "active" : ""} onClick={() => setToolFilter("all")}>全部 <b>{rows.length}</b></button>{Object.entries(labels).map(([id, label]) => <button key={id} className={toolFilter === id ? "active" : ""} onClick={() => setToolFilter(id)}>{label} <b>{rows.filter((row) => row.tool === id).length}</b></button>)}</div><div className="artifact-filter-selects"><label>教材主題<select value={topicFilter} onChange={(event) => setTopicFilter(event.target.value)}><option value="all">全部主題</option>{topics.map((topic) => <option key={topic} value={topic}>{topic}</option>)}</select></label><label>發布狀態<select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="all">全部狀態</option><option value="pending_review">待審核</option><option value="published">已發布</option></select></label></div><p>目前顯示 {filteredRows.length} 筆成果</p></div>}
    {filteredRows.length > 0 && <div className="artifact-toolbar"><label><input type="checkbox" checked={allSelected} onChange={() => setSelected(allSelected ? selected.filter((id) => !filteredIds.includes(id)) : [...new Set([...selected, ...filteredIds])])} /> 全選目前分類</label><span>已選 {selected.length} 筆</span><div><button onClick={() => void mutate("publish", selected)} disabled={!selected.length || busy}>一鍵發布所選</button><button className="secondary" onClick={() => void mutate("unpublish", selected)} disabled={!selected.length || busy}>下架所選</button><button className="danger" onClick={() => void removeSelected()} disabled={!selected.length || busy}>刪除所選</button></div></div>}
    <div className="artifact-list">{filteredRows.length ? filteredRows.map((row) => <article key={row.id} className={selected.includes(row.id) ? "selected" : ""}>
      <label className="artifact-select"><input type="checkbox" checked={selected.includes(row.id)} onChange={() => toggle(row.id)} /><span className="sr-only">選取 {row.topic}</span></label>
      <div className="artifact-body"><small>{labels[row.tool] || row.tool}</small><h3>{row.topic}</h3>{editingId === row.id ? <div className="artifact-editor"><label>內容<textarea rows={14} value={draftContent} onChange={(event) => setDraftContent(event.target.value)} /></label><label>教材來源註記<input value={draftSourceLabel} onChange={(event) => setDraftSourceLabel(event.target.value)} /></label><div><button onClick={() => void saveEdit()} disabled={!draftContent.trim() || busy}>儲存修改</button><button className="secondary" onClick={() => setEditingId(null)} disabled={busy}>取消</button></div></div> : <><p>{row.content.slice(0, 180)}{row.content.length > 180 ? "…" : ""}</p><em>共用 {row.reuseCount} 次</em>{row.tool === "audio" && <p className="artifact-audio-note">請到下方「通勤語音摘要」逐段編輯、複製口語稿、上傳音檔並試聽。</p>}</>}</div>
      <div className="artifact-actions"><b className={row.reviewStatus === "published" ? "published" : "pending"}>{row.reviewStatus === "published" ? "已發布" : "待審核"}</b><button className="secondary" onClick={() => beginEdit(row)} disabled={busy || editingId === row.id}>編輯</button><button onClick={() => void mutate(row.reviewStatus === "published" ? "unpublish" : "publish", [row.id])} disabled={busy}>{row.reviewStatus === "published" ? "下架" : "發布到前台"}</button></div>
    </article>) : <p>{rows.length ? "目前分類沒有符合的成果。" : "尚無可管理的學習成果；請先在下方產生內容。"}</p>}</div>
  </section>;
}
