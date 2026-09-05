"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

const themes = ["行政法理論基礎與行政組織法", "行政處分", "行政契約與行政命令", "行政罰法", "行政執行法", "訴願法與行政訴訟法", "國家賠償法與損失補償", "新進實務見解整理"];
type ReaderData = { topic: string; themeNumber: number; blocks: Array<{ heading: string; paragraphs: string[] }>; page: number; pageCount: number; bookPageLabel: string };

export default function ChapterReader() {
  const params = useSearchParams();
  const initial = params.get("topic");
  const [topic, setTopic] = useState(themes.includes(initial || "") ? initial! : themes[0]);
  const [page, setPage] = useState(0);
  const [data, setData] = useState<ReaderData | null>(null);
  const [status, setStatus] = useState("正在整理章節內容…");
  useEffect(() => {
    let active = true;
    setData(null); setStatus("正在整理章節內容…");
    void fetch(`/api/teachers/pengli/chapter-content?topic=${encodeURIComponent(topic)}&page=${page}`, { cache: "no-store" })
      .then(async (response) => { const body = await response.json(); if (!response.ok) throw new Error(body.error || "內容載入失敗"); return body; })
      .then((body) => { if (active) setData(body); })
      .catch((error) => { if (active) setStatus(error instanceof Error ? error.message : "內容載入失敗"); });
    return () => { active = false; };
  }, [topic, page]);
  function selectTopic(next: string) { setTopic(next); setPage(0); history.replaceState(null, "", `?topic=${encodeURIComponent(next)}`); }
  const paragraphs = data ? [...new Map(data.blocks.flatMap((block) => block.paragraphs).map((paragraph) => [paragraph.replace(/\s+/gu, " ").trim(), paragraph])).values()] : [];
  return <section className="chapter-reader">
    <header className="reader-heading"><div><span>CHAPTER READER</span><h1>章節閱讀</h1></div><p>內容只在站內依段落重新排版，不提供教材原檔或下載入口。</p></header>
    <div className="reader-layout">
      <aside className="reader-toc" aria-label="八大主題">{themes.map((name, index) => <button className={name === topic ? "active" : ""} onClick={() => selectTopic(name)} key={name}><small>{String(index + 1).padStart(2, "0")}</small><span>{name}</span></button>)}</aside>
      <article className="reader-paper">
        {!data ? <div className="reader-status">{status}</div> : <>
          <header><span>主題 {String(data.themeNumber).padStart(2, "0")}</span><h2>{data.topic}</h2><small>書內頁碼 {data.bookPageLabel}</small></header>
          <div className="reader-content">{paragraphs.map((paragraph, index) => <p key={`${index}-${paragraph.slice(0, 24)}`}>{paragraph}</p>)}</div>
          <nav className="reader-pagination" aria-label="章節分頁"><button disabled={data.page <= 0} onClick={() => setPage((value) => Math.max(0, value - 1))}>上一頁</button><span>{data.page + 1} / {data.pageCount}</span><button disabled={data.page + 1 >= data.pageCount} onClick={() => setPage((value) => value + 1)}>下一頁</button></nav>
        </>}
      </article>
    </div>
  </section>;
}
