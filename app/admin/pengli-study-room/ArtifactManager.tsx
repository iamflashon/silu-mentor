"use client";

import { useEffect, useState } from "react";

type Artifact = {
  id: number; tool: string; topic: string; content: string; sourceLabel: string;
  reviewStatus: string; reuseCount: number; updatedAt: string;
};

const labels: Record<string, string> = {
  guide: "完整讀書指南", quiz: "反過來考我", priority: "考前重點排序", explain: "概念拆解",
  gaps: "教材銜接缺口", mock: "完整模擬考", audio: "通勤語音摘要", teach: "換你教一次",
};

export default function ArtifactManager() {
  const [rows, setRows] = useState<Artifact[]>([]);
  const [notice, setNotice] = useState("");
  async function load() {
    const response = await fetch("/api/admin/pengli-study-artifacts", { cache: "no-store" });
    const data = await response.json() as { rows?: Artifact[]; error?: string };
    if (response.ok) setRows(data.rows || []); else setNotice(data.error || "成果庫讀取失敗。");
  }
  useEffect(() => { void load(); }, []);
  async function update(id: number, action: "publish" | "unpublish") {
    setNotice("正在更新發布狀態…");
    const response = await fetch("/api/admin/pengli-study-artifacts", {
      method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, action }),
    });
    const data = await response.json() as { error?: string };
    setNotice(response.ok ? (action === "publish" ? "已發布，學生前台現在可直接閱讀。" : "已下架，學生前台不再顯示。") : data.error || "更新失敗。");
    if (response.ok) await load();
  }
  return <section className="artifact-manager">
    <header><div><span>PUBLISHING</span><h2>成果發布管理</h2><p>產生後先保留為待審；確認內容後發布，才會出現在學生端。</p></div><button onClick={load}>重新整理</button></header>
    {notice && <p className="artifact-notice">{notice}</p>}
    <div className="artifact-list">{rows.length ? rows.map((row) => <article key={row.id}>
      <div><small>{labels[row.tool] || row.tool}</small><h3>{row.topic}</h3><p>{row.content.slice(0, 110)}{row.content.length > 110 ? "…" : ""}</p><em>共用 {row.reuseCount} 次</em></div>
      <div><b className={row.reviewStatus === "published" ? "published" : "pending"}>{row.reviewStatus === "published" ? "已發布" : "待審核"}</b><button onClick={() => void update(row.id, row.reviewStatus === "published" ? "unpublish" : "publish")}>{row.reviewStatus === "published" ? "下架" : "發布到前台"}</button></div>
    </article>) : <p>尚無可管理的學習成果；請先在下方產生內容。</p>}</div>
  </section>;
}
