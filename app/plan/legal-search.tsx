"use client";

import { FormEvent, useEffect, useState } from "react";

type LegalResult = { documentId: number; title: string; category: string; classification: string; modifiedDate: string; sourceUrl: string; articleNo: string; hierarchy: string; content: string; excerpt: string };
type SavedNote = { id: number; title: string; content: string; subject: string; tags: string; sourceLabel: string; updatedAt: string };
type InlineMessage = { role: "mentor" | "student"; text: string };

type LearningDirection = "articles" | "issues" | "questions" | "guide";

const RELATED_CONCEPTS: Array<{ terms: string[]; related: string[] }> = [
  { terms: ["行政處分"], related: ["行政行為", "訴願", "撤銷訴訟", "行政程序", "公法上權利"] },
  { terms: ["正當防衛"], related: ["現在不法侵害", "防衛意思", "必要性", "防衛過當", "緊急避難"] },
  { terms: ["侵權", "民法第184條", "第184條"], related: ["故意過失", "不法性", "損害", "因果關係", "舉證責任"] },
  { terms: ["殺人", "刑法第271條", "第271條"], related: ["殺人故意", "既遂未遂", "因果關係", "客觀歸責", "罪數"] },
  { terms: ["民法"], related: ["法律行為", "意思表示", "代理", "消滅時效", "權利能力"] },
  { terms: ["刑法"], related: ["構成要件", "違法性", "罪責", "未遂", "競合"] },
];

function relatedConcepts(query: string, result: LegalResult) {
  const source = `${query} ${result.title} ${result.articleNo} ${result.content}`;
  const matched = RELATED_CONCEPTS.filter((group) => group.terms.some((term) => source.includes(term))).flatMap((group) => group.related);
  return [...new Set(matched)].filter((term) => !query.includes(term)).slice(0, 5);
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function HighlightedText({ text, query, related }: { text: string; query: string; related: string[] }) {
  const exactTerms = [...new Set([query.trim(), query.replace(/\s+/g, "")].filter((term) => term.length >= 2))];
  const terms = [...exactTerms, ...related].sort((a, b) => b.length - a.length);
  if (!terms.length) return <>{text}</>;
  const matcher = new RegExp(`(${terms.map(escapeRegExp).join("|")})`, "g");
  return <>{text.split(matcher).map((part, index) => {
    if (exactTerms.includes(part)) return <mark className="search-hit" key={`${part}-${index}`}>{part}</mark>;
    if (related.includes(part)) return <mark className="related-hit" key={`${part}-${index}`}>{part}</mark>;
    return <span key={`${part}-${index}`}>{part}</span>;
  })}</>;
}

const CORE_LAWS = [
  { title: "憲法", hint: "基本權、憲政機關", query: "憲法" },
  { title: "行政法", hint: "行政處分、行政救濟", query: "行政法" },
  { title: "民法", hint: "總則、債權、物權、親屬繼承", query: "民法" },
  { title: "民事訴訟法", hint: "訴訟程序與審理", query: "民事訴訟法" },
  { title: "刑法", hint: "犯罪成立與刑事責任", query: "刑法" },
  { title: "刑事訴訟法", hint: "偵查、審判與證據", query: "刑事訴訟法" },
] as const;

function handoffPrompt(result: LegalResult, direction: LearningDirection, query: string) {
  const requests: Record<LearningDirection, string> = {
    articles: "整理直接相關與容易一起考的法條，說明彼此關係；限中華民國現行法。",
    issues: "整理司律考試可能形成的核心爭點、實務見解與作答架構。",
    questions: "找出可對應的司律歷屆考題或相近題型，並說明它如何考這個概念；找不到真實題目時不得虛構題號。",
    guide: "依我的程度設計一段短學習：先解釋規範功能，再用一個可直接回答的小問題引導我。",
  };
  return `我搜尋的關鍵字是「${query}」。請延伸學習「${result.title}」${result.articleNo ? `的${result.articleNo}` : ""}。\n原條文：${result.content}\n任務：${requests[direction]}`;
}

export function LegalSearch() {
  const [query, setQuery] = useState("");
  const [searchedQuery, setSearchedQuery] = useState("");
  const [category, setCategory] = useState("");
  const [results, setResults] = useState<LegalResult[]>([]);
  const [searched, setSearched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notes, setNotes] = useState<SavedNote[]>([]);
  const [noteTarget, setNoteTarget] = useState<LegalResult | null>(null);
  const [noteId, setNoteId] = useState<number | "new" | "">("");
  const [noteTitle, setNoteTitle] = useState("");
  const [noteMessage, setNoteMessage] = useState("");
  const [expandedResult, setExpandedResult] = useState<string | null>(null);
  const [learningResult, setLearningResult] = useState<string | null>(null);
  const [learningTarget, setLearningTarget] = useState<LegalResult | null>(null);
  const [inlineMessages, setInlineMessages] = useState<InlineMessage[]>([]);
  const [inlineInput, setInlineInput] = useState("");
  const [inlineThinking, setInlineThinking] = useState(false);
  const [sessionId, setSessionId] = useState<number | null>(null);

  useEffect(() => {
    fetch("/api/notes").then(async (response) => {
      if (!response.ok) return;
      const result = await response.json() as { notes?: SavedNote[] };
      setNotes(result.notes ?? []);
    });
  }, []);

  useEffect(() => {
    fetch("/api/chat/history").then(async (response) => {
      if (!response.ok) return;
      const result = await response.json() as { sessionId?: number | null };
      setSessionId(result.sessionId ?? null);
    }).catch(() => undefined);
  }, []);

  async function search(value = query, requestedCategory = category) {
    const text = value.trim();
    if (!text) return;
    setLoading(true); setError(""); setSearched(true);
    try {
      const response = await fetch(`/api/legal-search?q=${encodeURIComponent(text)}&category=${encodeURIComponent(requestedCategory)}`);
      const result = await response.json() as { results?: LegalResult[]; error?: string };
      if (!response.ok) throw new Error(result.error ?? "法規搜尋失敗");
      setResults(result.results ?? []);
      setSearchedQuery(text);
    } catch (reason) {
      setResults([]); setError(reason instanceof Error ? reason.message : "法規搜尋失敗");
    } finally { setLoading(false); }
  }

  async function sendInline(text: string, target = learningTarget, seedMessages = inlineMessages) {
    const value = text.trim();
    if (!value || !target || inlineThinking) return;
    const nextMessages: InlineMessage[] = [...seedMessages, { role: "student", text: value }];
    setInlineMessages(nextMessages);
    setInlineInput("");
    setInlineThinking(true);
    try {
      const response = await fetch("/api/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ messages: nextMessages.slice(-12), sessionId }) });
      const result = await response.json() as { reply?: string; sessionId?: number; error?: string };
      if (!response.ok || !result.reply) throw new Error(result.error ?? "AI 對話暫時無法使用");
      setInlineMessages((current) => [...current, { role: "mentor", text: result.reply! }]);
      if (result.sessionId) setSessionId(result.sessionId);
    } catch (reason) {
      setInlineMessages((current) => [...current, { role: "mentor", text: reason instanceof Error ? reason.message : "AI 對話暫時無法使用" }]);
    } finally {
      setInlineThinking(false);
    }
  }

  function startLearning(result: LegalResult, direction: LearningDirection) {
    const prompt = handoffPrompt(result, direction, searchedQuery || query);
    setLearningTarget(result);
    setInlineMessages([]);
    void sendInline(prompt, result, []);
  }

  function submitInline(event: FormEvent) {
    event.preventDefault();
    void sendInline(inlineInput);
  }

  function openNotePicker(result: LegalResult) {
    setNoteTarget(result);
    setNoteId(notes[0]?.id ?? "new");
    setNoteTitle(`${result.title}${result.articleNo ? ` ${result.articleNo}` : ""}`);
    setNoteMessage("");
  }

  async function addToNote() {
    if (!noteTarget || !noteId) return;
    const block = `【${noteTarget.title}${noteTarget.articleNo ? ` ${noteTarget.articleNo}` : ""}】\n${noteTarget.content || noteTarget.excerpt}\n官方來源：${noteTarget.sourceUrl || "未提供"}`;
    let response: Response;
    if (noteId === "new") {
      response = await fetch("/api/notes", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: noteTitle.trim() || "法規筆記", content: block, subject: noteTarget.category || "綜合", sourceType: "legal", sourceId: String(noteTarget.documentId), sourceLabel: "全國法規資料庫" }) });
    } else {
      const note = notes.find((item) => item.id === noteId);
      if (!note) return;
      response = await fetch("/api/notes", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...note, content: note.content.trim() ? `${note.content.trim()}\n\n${block}` : block }) });
    }
    const result = await response.json() as { note?: SavedNote; error?: string };
    if (!response.ok) { setNoteMessage(result.error ?? "加入筆記失敗"); return; }
    if (result.note) setNotes((current) => [result.note!, ...current.filter((note) => note.id !== result.note!.id)]);
    setNoteMessage("已加入指定筆記");
    setNoteTarget(null);
  }

  return <section className="legal-search-panel" aria-label="全國法規搜尋與內容瀏覽">
    <div className="legal-search-head"><div><p>OFFICIAL LAW SEARCH</p><h2>全國法規搜尋</h2><span>輸入法規名稱、條號或關鍵字查詢；搜尋結果可直接查看完整條文與官方來源。</span></div><strong>查法條</strong></div>
    <section className="core-law-guide" aria-label="司律核心六法">
      <div className="core-law-guide-head"><div><b>司律核心六法</b><span>先從最重要的六個法科開始，需要其他法規再直接搜尋。</span></div></div>
      <div className="core-law-grid">{CORE_LAWS.map((law) => <button type="button" key={law.title} onClick={() => { setQuery(law.query); setCategory(""); void search(law.query, ""); }}><strong>{law.title}</strong><small>{law.hint}</small><span>搜尋相關法條 →</span></button>)}</div>
    </section>
    <form className="legal-search-form" onSubmit={(event) => { event.preventDefault(); void search(); }}><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜尋法規名稱、條號或關鍵字，例如：刑法第271條" aria-label="法規搜尋關鍵字" /><select value={category} onChange={(event) => setCategory(event.target.value)} aria-label="法規類別"><option value="">全部</option><option value="法律">法律</option><option value="命令">命令</option></select><button className="primary-btn" disabled={loading}>{loading ? "搜尋中…" : "搜尋"}</button></form>
    <div className="legal-search-suggestions"><span>快速搜尋</span>{["刑法第271條", "正當防衛", "民法第184條", "行政處分"].map((item) => <button type="button" key={item} onClick={() => { setQuery(item); void search(item); }}>{item}</button>)}</div>
    {error && <p className="legal-search-error">{error}</p>}
    {searched && !loading && !error && !results.length && <div className="legal-search-empty">沒有找到相符條文。可以改用法規名稱、條號或較短的關鍵字。</div>}
    <div className="search-highlight-legend"><span><i className="exact" />搜尋關鍵字</span><span><i className="related" />關聯概念</span></div>
    <div className="legal-result-list">{results.map((result, index) => {
      const resultKey = `${result.documentId}-${result.articleNo}-${index}`;
      const related = relatedConcepts(searchedQuery || query, result);
      const expanded = expandedResult === resultKey;
      const learningOpen = learningResult === resultKey;
      return <article className="legal-result" key={resultKey}>
        <div className="legal-result-meta"><span>{result.category || "法規"}</span><b><HighlightedText text={result.title} query={searchedQuery || query} related={related} /></b><small>{result.classification ? `${result.classification} · ` : ""}{result.articleNo || result.hierarchy || "條文"}</small></div>
        <p><HighlightedText text={result.excerpt} query={searchedQuery || query} related={related} /></p>
        {!!related.length && <div className="related-concept-row"><span>可能相關</span>{related.map((concept) => <button type="button" key={concept} onClick={() => { setQuery(concept); void search(concept); }}>{concept}</button>)}</div>}
        {expanded && <section className="inline-original-law" aria-label="原條文"><header><b>原條文</b><span>{result.title} {result.articleNo}</span></header><p><HighlightedText text={result.content} query={searchedQuery || query} related={related} /></p></section>}
        {learningOpen && <section className="learning-directions" aria-label="延伸學習分類"><header><b>想從哪個方向延伸？</b><span>AI 會留在本頁對答，並接續保存到學習紀錄。</span></header><div><button type="button" onClick={() => startLearning(result, "articles")}><b>相關法條</b><span>前後條文與規範關係</span></button><button type="button" onClick={() => startLearning(result, "issues")}><b>核心爭點</b><span>實務、學說與作答架構</span></button><button type="button" onClick={() => startLearning(result, "questions")}><b>歷屆考題</b><span>真題與相近考法</span></button><button type="button" onClick={() => startLearning(result, "guide")}><b>引導學習</b><span>說明後用問題帶著學</span></button></div>{learningTarget === result && <div className="inline-law-chat" aria-live="polite">{inlineMessages.map((message, messageIndex) => <div className={message.role} key={`${message.role}-${messageIndex}`}><b>{message.role === "mentor" ? "司律導師" : "我"}</b><p>{message.text}</p></div>)}{inlineThinking && <div className="mentor thinking"><b>司律導師</b><p>正在依條文與關鍵字整理…</p></div>}<form onSubmit={submitInline}><input value={inlineInput} onChange={(event) => setInlineInput(event.target.value)} placeholder="接著問這個條文、爭點或考題…" aria-label="延伸學習對話" /><button type="submit" disabled={inlineThinking || !inlineInput.trim()}>送出</button></form></div>}</section>}
        <footer><a href={result.sourceUrl || "#"} target="_blank" rel="noreferrer">官方來源</a><button type="button" aria-expanded={expanded} onClick={() => setExpandedResult(expanded ? null : resultKey)}>{expanded ? "收合原文" : "查看原文"}</button><button type="button" onClick={() => openNotePicker(result)}>加入筆記</button><button type="button" aria-expanded={learningOpen} onClick={() => setLearningResult(learningOpen ? null : resultKey)}>{learningOpen ? "收合延伸" : "延伸學習"}</button></footer>
        {noteTarget === result && <div className="legal-note-picker"><label>指定筆記<select value={noteId} onChange={(event) => setNoteId(event.target.value === "new" ? "new" : Number(event.target.value))}><option value="new">＋ 新增自訂筆記</option>{notes.map((note) => <option key={note.id} value={note.id}>{note.title || "未命名筆記"}</option>)}</select></label>{noteId === "new" && <label>新筆記名稱<input value={noteTitle} onChange={(event) => setNoteTitle(event.target.value)} /></label>}<div><button type="button" onClick={() => setNoteTarget(null)}>取消</button><button type="button" className="primary-btn" onClick={() => void addToNote()}>確認加入</button></div></div>}
      </article>;
    })}</div>
    {noteMessage && <p className="legal-note-message">{noteMessage}</p>}
  </section>;
}
