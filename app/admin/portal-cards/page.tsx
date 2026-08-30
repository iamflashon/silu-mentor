"use client";

import { useEffect, useState } from "react";
import CentralAdminTabs from "../CentralAdminTabs";
import type { PortalModule } from "../../../lib/portal-modules";

type Card = { id: "law" | "pengli" | "medtech" | "accounting"; enabled: boolean; order: number };

const details = {
  pengli: { mark: "狸", title: "彭狸老師・行政法考點衝刺", subtitle: "法律類・行政法・司律二試", href: "/teachers/pengli", tone: "law", cover: true },
  law: { mark: "律", title: "司律備考平台", subtitle: "平台入口（可獨立關閉）", href: "/law", tone: "law", cover: false },
  medtech: { mark: "醫", title: "康情老師・臨床病毒學", subtitle: "醫事檢驗師國考", href: "/medtech", tone: "medtech", cover: true },
  accounting: { mark: "會", title: "中級會計題庫制霸", subtitle: "會研所・會計專業", href: "/accounting", tone: "accounting", cover: true },
};

export default function PortalCardsAdminPage() {
  const [cards, setCards] = useState<Card[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [coverVersion, setCoverVersion] = useState<Record<string, number>>({});
  const [modules, setModules] = useState<PortalModule[]>([]);

  useEffect(() => { void Promise.all([fetch("/api/portal-cards", { cache: "no-store" }), fetch("/api/portal-modules?scope=pengli", { cache: "no-store" })]).then(async ([cardsResponse, modulesResponse]) => { const cardsData = await cardsResponse.json(); const modulesData = await modulesResponse.json(); setCards(cardsData.cards ?? []); setModules(modulesData.modules ?? []); }); }, []);

  function move(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= cards.length) return;
    const next = [...cards];
    [next[index], next[target]] = [next[target], next[index]];
    setCards(next.map((card, order) => ({ ...card, order: order + 1 })));
  }

  function moveModule(index: number, direction: -1 | 1) {
    const target = index + direction; if (target < 0 || target >= modules.length) return;
    const next = [...modules]; [next[index], next[target]] = [next[target], next[index]];
    setModules(next.map((module, order) => ({ ...module, order: order + 1 })));
  }

  async function save() {
    setBusy(true); setNotice("");
    try {
      const response = await fetch("/api/portal-cards", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ cards }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "儲存失敗");
      const moduleResponse = await fetch("/api/portal-modules", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ modules }) });
      const moduleData = await moduleResponse.json();
      if (!moduleResponse.ok) throw new Error(moduleData.error || "模組儲存失敗");
      setCards(data.cards); setModules(moduleData.modules ?? modules); setNotice("已更新首頁卡片與彭狸功能模組。");
    } catch (error) { setNotice(error instanceof Error ? error.message : "儲存失敗"); }
    finally { setBusy(false); }
  }

  async function uploadCover(id: Card["id"], file: File) {
    setBusy(true); setNotice("");
    const form = new FormData(); form.set("id", id); form.set("file", file);
    try { const response = await fetch("/api/portal-cards/cover", { method: "POST", body: form }); const data = await response.json(); if (!response.ok) throw new Error(data.error || "書封上傳失敗"); setCoverVersion((value) => ({ ...value, [id]: Date.now() })); setNotice("書封已更新，首頁會同步使用。"); }
    catch (error) { setNotice(error instanceof Error ? error.message : "書封上傳失敗"); }
    finally { setBusy(false); }
  }

  return <main className="portal-card-admin">
    <header><div><span>PORTAL CONTENT CONTROL</span><h1>首頁書籍與老師卡片管理</h1><p>控制書籍老師卡與司律平台入口。下架只隱藏首頁內容，不會刪除專區、會員或資料。</p></div><a href="/">查看入口首頁 ↗</a></header>
    <CentralAdminTabs active="portal-cards" />
    <section className="portal-card-admin-list">
      {cards.map((card, index) => { const item = details[card.id]; return <article key={card.id} className={card.enabled ? "enabled" : "disabled"}>
        <div className={`portal-card-admin-mark ${item.tone}`}>{item.cover ? <><img src={`/api/portal-cards/cover?id=${card.id}&v=${coverVersion[card.id] ?? 0}`} alt={`${item.title}書封`} onError={(event) => { event.currentTarget.style.display = "none"; }} /><label className="portal-cover-upload">上傳／更換書封<input type="file" accept="image/jpeg,image/png,image/webp" disabled={busy} onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadCover(card.id, file); event.currentTarget.value = ""; }} /></label></> : item.mark}</div>
        <div className="portal-card-admin-copy"><small>{item.subtitle}</small><h2>{item.title}</h2><span>{item.href}</span></div>
        <div className="portal-card-admin-order"><button onClick={() => move(index, -1)} disabled={index === 0} aria-label={`${item.title}往上移`}>↑</button><b>{index + 1}</b><button onClick={() => move(index, 1)} disabled={index === cards.length - 1} aria-label={`${item.title}往下移`}>↓</button></div>
        <label className="portal-card-switch"><input type="checkbox" checked={card.enabled} onChange={(event) => setCards((rows) => rows.map((row) => row.id === card.id ? { ...row, enabled: event.target.checked } : row))} /><span /><b>{card.enabled ? "已上架" : "已下架"}</b></label>
      </article>; })}
    </section>
    <section className="portal-module-admin">
      <header><div><span>PENGLI MODULE REGISTRY</span><h2>彭狸專區功能模組</h2><p>先管理哪些能力出現在專區；模組內部的 AI、PDF、點數和法規流程由共用核心負責。</p></div><b>{modules.filter((module) => module.enabled).length} / {modules.length} 啟用</b></header>
      <div className="portal-module-list">{modules.map((module, index) => <article className={module.enabled ? "enabled" : "disabled"} key={module.id}><span className="portal-module-icon">{module.icon}</span><div><strong>{module.label}</strong><p>{module.description}</p><small>{module.href} · {module.action}</small></div><div className="portal-module-actions"><button onClick={() => moveModule(index, -1)} disabled={index === 0} aria-label="模組上移">↑</button><button onClick={() => moveModule(index, 1)} disabled={index === modules.length - 1} aria-label="模組下移">↓</button><label><input type="checkbox" checked={module.enabled} onChange={(event) => setModules((rows) => rows.map((row) => row.id === module.id ? { ...row, enabled: event.target.checked } : row))} />{module.enabled ? "顯示" : "隱藏"}</label></div></article>)}</div>
      <p className="portal-module-hint">目前先鎖定公版模組，確保核心流程不被誤改；下一階段再加入頁面內拖曳與新增元件。</p>
    </section>
    <footer><p>{notice || "調整完成後請按儲存；首頁會依照此處的順序排列。"}</p><button onClick={save} disabled={busy || !cards.length}>{busy ? "儲存中…" : "儲存首頁設定"}</button></footer>
  </main>;
}
