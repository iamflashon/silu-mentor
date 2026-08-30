"use client";
import { useMemo, useState } from "react";
import type { V2Config, V2TeacherKey } from "../../lib/v2-platform";

type Teacher = { key: V2TeacherKey; name: string; subject: string; brandNote: string; bookCount: number; questionCount: number; sample: unknown };
export default function V2Preview({ catalog, config }: { catalog: { teachers: Record<V2TeacherKey, Teacher> }; config: V2Config }) {
  const [brand, setBrand] = useState<"get" | "angle">("get");
  const visible = useMemo(() => Object.values(catalog.teachers).filter((item) => config.teachers[item.key].enabled && config.teachers[item.key].status === "published" && config.teachers[item.key].brands.includes(brand)), [brand, catalog, config]);
  const angle = brand === "angle";
  return <main className={`v2-shell ${angle ? "angle" : "get"}`}>
    <header className="v2-top"><a href="/">iBrain Pedia X</a><div className="v2-brand-switch" aria-label="切換品牌入口"><button className={!angle ? "active" : ""} onClick={() => setBrand("get")}>高點入口</button><button className={angle ? "active" : ""} onClick={() => setBrand("angle")}>元照入口</button></div><a href="/admin/v2-platform">管理後台</a></header>
    <section className="v2-hero"><div><span>{angle ? "ANGLE KNOWLEDGE × AI" : "GET TRAINING × AI"}</span><h1>{config.brands[brand].label}</h1><p>{angle ? "以作者、書籍、解題書與法律知識內容為核心，進入可追問、可練習、可批改的互動學習。" : "把教材、題庫、AI批改、微課補強與真人覆核放進同一個訓練流程。"}</p></div><aside><b>V2功能原型</b><span>讀取現有真實書籍與題庫資料</span><span>暫不開啟PDF閱讀</span></aside></section>
    <section className="v2-flow" aria-label="學習閉環">{["學教材","練題目","AI批改","診斷弱點","微課補強","重新練習"].map((item, index) => <div key={item}><small>{String(index + 1).padStart(2, "0")}</small><b>{item}</b></div>)}</section>
    <section className="v2-teachers"><header><div><span>ACTIVE LEARNING SPACES</span><h2>{angle ? "從作者與書籍進入解題室" : "選擇老師，開始實際訓練"}</h2></div><p>同一套核心能力，依老師、題型及品牌設定不同模組。</p></header><div className="v2-teacher-grid">{visible.map((teacher) => { const space = config.teachers[teacher.key]; return <article className={`teacher-${teacher.key}`} key={teacher.key}><div className="v2-teacher-mark">{space.name.slice(0, 1)}</div><div><small>{teacher.brandNote}</small><h3>{space.zoneTitle}</h3><p>{space.summary}</p><dl><div><dt>已拆解書籍／文件</dt><dd>{teacher.bookCount}</dd></div><div><dt>題庫主檔</dt><dd>{teacher.questionCount.toLocaleString()}</dd></div></dl><div className="v2-module-tags">{space.modules.slice(0, 5).map((module) => <span key={module}>{moduleLabel[module]}</span>)}</div><a href={`/v2-preview/${teacher.key}?brand=${brand}`}>進入正式模組專區 →</a></div></article>; })}</div></section>
  </main>;
}
const moduleLabel: Record<string, string> = { book: "教材", coach: "AI教練", questionBank: "題庫", grading: "AI批改", wrongReview: "錯題", microCourse: "微課", humanReview: "真人覆核", legalSearch: "法規查詢" };
