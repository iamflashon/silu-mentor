"use client";

import { useEffect, useState } from "react";

type Card = { id: "law" | "medtech"; enabled: boolean; order: number };

const details = {
  law: { mark: "律", title: "司律備考", subtitle: "律師・司法官國考", href: "/law", tone: "law" },
  medtech: { mark: "醫", title: "醫檢國考", subtitle: "醫事檢驗師國考", href: "/medtech", tone: "medtech" },
};

export default function PortalCardsAdminPage() {
  const [cards, setCards] = useState<Card[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  useEffect(() => { void fetch("/api/portal-cards", { cache: "no-store" }).then((response) => response.json()).then((data) => setCards(data.cards ?? [])); }, []);

  function move(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= cards.length) return;
    const next = [...cards];
    [next[index], next[target]] = [next[target], next[index]];
    setCards(next.map((card, order) => ({ ...card, order: order + 1 })));
  }

  async function save() {
    setBusy(true); setNotice("");
    try {
      const response = await fetch("/api/portal-cards", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ cards }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "儲存失敗");
      setCards(data.cards); setNotice("已更新 iBrain Pedia X 首頁卡片。");
    } catch (error) { setNotice(error instanceof Error ? error.message : "儲存失敗"); }
    finally { setBusy(false); }
  }

  return <main className="portal-card-admin">
    <header><div><span>PORTAL CONTENT CONTROL</span><h1>首頁類科卡片管理</h1><p>控制 iBrain Pedia X 首頁顯示的類科入口。下架只隱藏卡片，不會刪除平台、會員或資料。</p></div><a href="/">查看入口首頁 ↗</a></header>
    <nav><a href="/admin/library">教材向量庫</a><a href="/admin/question-bank">總題庫管理</a><a href="/admin/members">會員總管理</a><a href="/admin/ai-access">AI 方案與啟用碼</a><a className="active" href="/admin/portal-cards">首頁卡片管理</a></nav>
    <section className="portal-card-admin-list">
      {cards.map((card, index) => { const item = details[card.id]; return <article key={card.id} className={card.enabled ? "enabled" : "disabled"}>
        <div className={`portal-card-admin-mark ${item.tone}`}>{item.mark}</div>
        <div className="portal-card-admin-copy"><small>{item.subtitle}</small><h2>{item.title}</h2><span>{item.href}</span></div>
        <div className="portal-card-admin-order"><button onClick={() => move(index, -1)} disabled={index === 0} aria-label={`${item.title}往上移`}>↑</button><b>{index + 1}</b><button onClick={() => move(index, 1)} disabled={index === cards.length - 1} aria-label={`${item.title}往下移`}>↓</button></div>
        <label className="portal-card-switch"><input type="checkbox" checked={card.enabled} onChange={(event) => setCards((rows) => rows.map((row) => row.id === card.id ? { ...row, enabled: event.target.checked } : row))} /><span /><b>{card.enabled ? "已上架" : "已下架"}</b></label>
      </article>; })}
    </section>
    <footer><p>{notice || "調整完成後請按儲存；首頁會依照此處的順序排列。"}</p><button onClick={save} disabled={busy || !cards.length}>{busy ? "儲存中…" : "儲存首頁設定"}</button></footer>
  </main>;
}
