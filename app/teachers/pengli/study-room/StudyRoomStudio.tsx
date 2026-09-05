"use client";

import { useEffect, useMemo, useState } from "react";

const topics = ["行政法理論基礎與行政組織法", "行政處分", "行政契約與行政命令", "行政罰法", "行政執行法", "訴願法與行政訴訟法", "國家賠償法與損失補償", "新進實務見解整理"];
const tools = [
  { id: "guide", no: "01", title: "完整讀書指南", description: "完整整理全部爭點、核心概念、常見誤解與考題，建立教材地圖。", prompt: "用彭狸老師教材中的【{topic}】做一份完整讀書指南，依爭點分類。每個爭點包含：3 個核心概念、2 個常見誤解、2 道附解答的考題。只能根據教材，並標示依據頁碼。" },
  { id: "quiz", no: "02", title: "反過來考我", description: "從基礎題開始，一次只問一題；答完才訂正並提高難度。", prompt: "針對【{topic}】最重要的概念對我進行測驗。從基礎題開始，逐步提高難度。一次只能出一題，不要先公布答案；等我回答後，再依教材給回饋與說明，確認後才出下一題。" },
  { id: "priority", no: "03", title: "考前重點排序", description: "只挑前 5 大重點，依教材篇幅、重複程度與內容關聯排定衝刺順序。", prompt: "分析彭狸老師教材中的【{topic}】，整理最值得優先準備的 5 個考試爭點、為什麼重要，並為每個爭點各出一題高難度題。這是教材重點排序，不得宣稱能預測老師考題。" },
  { id: "explain", no: "04", title: "拆解看不懂的概念", description: "用類比、實際案例與常見誤解建立真正理解。", prompt: "請解釋【{concept}】，包含：一個容易理解的類比、一個行政法實際應用例子，以及一個最常見的錯誤理解。接著回到彭狸老師教材的正式用語與頁碼，最後只出一道題目考我。" },
  { id: "gaps", no: "05", title: "找出教材銜接缺口", description: "找出說明較少、前後銜接不足或需要補充才能理解的位置。", prompt: "請閱讀【{topic}】教材，找出其中說明較少或前後銜接不完整的概念，指出哪些部分需要額外補充才能理解，並提供簡短補充。必須區分教材原文與補充說明，不得把補充冒充成彭狸老師見解。" },
  { id: "mock", no: "06", title: "完整模擬考", description: "自訂選擇題、簡答題、申論題與考試時間。", prompt: "請依據【{topic}】出一份完整模擬考卷，包含 {mc} 題選擇題、{short} 題簡答題與 {essay} 題申論題，建議作答時間 {minutes} 分鐘。先只顯示試卷；答案、解析與申論評分重點另列在卷末。" },
  { id: "audio", no: "07", title: "通勤語音摘要", description: "先產生適合聆聽的複習稿，再由裝置朗讀。", prompt: "請把【{topic}】整理成適合通勤聆聽的繁體中文語音摘要稿，聚焦核心爭點，針對容易混淆的概念多做說明。這是複習內容，不適合作為第一次學習。控制在約 {minutes} 分鐘可聽完。" },
  { id: "teach", no: "08", title: "換你教一次", description: "你先說明，再依教材指出說對、遺漏與需要補強之處。", prompt: "我要用自己的話解釋【{concept}】。以下是我的說明：\n\n{answer}\n\n請依彭狸老師教材分成三部分回饋：我說對了什麼、我漏了什麼、哪裡需要補強。最後只問我一個能確認理解的追問題。" },
] as const;
const teachTemplate = `一、這個概念要處理的問題是：\n\n二、成立要件／判斷順序是：\n1. \n2. \n3. \n\n三、它會產生的法律效果是：\n\n四、最容易與它混淆的概念是：\n\n五、如果套用到實際案例，我會這樣判斷：\n\n六、我目前最不確定的地方是：`;
type Tool = typeof tools[number];
type StudioMessage = { role: "student" | "coach"; text: string };
type StudyRun = { id: number; tool: string; topic: string; outputText: string; sourceLabel: string; cacheHit: boolean; createdAt: string };
type PublishedArtifact = { id: number; tool: string; topic: string; content: string; sourceLabel: string; updatedAt: string };

function StudyContent({ text }: { text: string }) {
  const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
  return <div className="study-content">{lines.map((line, index) => {
    if (/^[=─—－]{4,}$/u.test(line)) return <hr key={index} />;
    if (/^【.+】$/u.test(line) || /^(第[一二三四五六七八九十]+部分|[一二三四五六七八九十]+、|卷[一二]|答案與解析)/u.test(line)) return <h4 key={index}>{line.replace(/^【|】$/gu, "")}</h4>;
    if (/^[（(][一二三四五六七八九十0-9]+[）)]/u.test(line) || /^\d+[.、]/u.test(line)) return <h5 key={index}>{line}</h5>;
    if (/^[※•●▪]|^[-–]\s/u.test(line)) return <p className="study-point" key={index}>{line.replace(/^[※•●▪-]\s*/u, "")}</p>;
    return <p key={index}>{line}</p>;
  })}</div>;
}

export default function StudyRoomStudio({ adminMode = false }: { adminMode?: boolean }) {
  const [active, setActive] = useState<Tool>(tools[0]);
  const [topic, setTopic] = useState(topics[0]);
  const [concept, setConcept] = useState("");
  const [answer, setAnswer] = useState("");
  const [mc, setMc] = useState(10), [short, setShort] = useState(3), [essay, setEssay] = useState(1), [minutes, setMinutes] = useState(30);
  const [result, setResult] = useState(""), [source, setSource] = useState(""), [error, setError] = useState(""), [loading, setLoading] = useState(false);
  const [quizAnswer, setQuizAnswer] = useState("");
  const [quizMessages, setQuizMessages] = useState<StudioMessage[]>([]);
  const [resultNote, setResultNote] = useState("");
  const [history, setHistory] = useState<StudyRun[]>([]), [showHistory, setShowHistory] = useState(false), [historyLoading, setHistoryLoading] = useState(false);
  const [published, setPublished] = useState<PublishedArtifact[]>([]), [showPublished, setShowPublished] = useState(false), [publishedLoading, setPublishedLoading] = useState(false);
  async function loadPublished(open = true) {
    if (open) { setShowPublished(true); setShowHistory(false); }
    setPublishedLoading(true);
    try {
      const response = await fetch("/api/teachers/pengli/study-room/published", { cache: "no-store" });
      const data = await response.json() as { rows?: PublishedArtifact[] };
      if (response.ok) setPublished(data.rows || []);
    } finally { setPublishedLoading(false); }
  }
  useEffect(() => { if (!adminMode) void loadPublished(false); }, [adminMode]);
  const prompt = useMemo(() => active.prompt.replaceAll("{topic}", topic).replaceAll("{concept}", concept.trim() || `「${topic}」中最重要的概念`).replaceAll("{answer}", answer.trim() || "（尚未填寫）").replaceAll("{mc}", String(mc)).replaceAll("{short}", String(short)).replaceAll("{essay}", String(essay)).replaceAll("{minutes}", String(minutes)), [active, topic, concept, answer, mc, short, essay, minutes]);
  async function run() {
    if (active.id === "teach" && !answer.trim()) { setError("請先用自己的話說明這個概念。"); return; }
    if (active.id === "mock" && mc + short + essay < 1) { setError("請至少設定一題選擇題、簡答題或申論題。"); return; }
    if (active.id === "mock" && minutes < 10) { setError("完整模擬考的作答時間至少需設定 10 分鐘。"); return; }
    setLoading(true); setError(""); setResult(""); setSource("");
    try {
      const response = await fetch("/api/teachers/pengli/coach", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode: "study-tool", studyTool: active.id, messages: [{ role: "student", text: prompt }], requestKey: crypto.randomUUID(), topic }) });
      const data = await response.json() as { reply?: string; source?: string; error?: string; cached?: boolean; saved?: boolean; charged?: boolean; reviewStatus?: string | null };
      if (!response.ok || !data.reply) throw new Error(data.error || "目前無法產生學習內容。");
      setResult(data.reply); setSource(data.source || "彭狸老師教材");
      setResultNote(data.cached ? "已從共用成果庫載入，本次不扣使用次數。" : data.saved ? (adminMode ? "已存入成果庫並列為待審核；請在上方確認後發布到前台。" : "已自動保存；內容會先由後台審核，發布後才供其他同學共用。") : "");
      if (active.id === "quiz") setQuizMessages([{ role: "student", text: prompt }, { role: "coach", text: data.reply }]);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "目前無法產生學習內容。"); }
    finally { setLoading(false); }
  }
  async function answerQuiz() {
    if (!quizAnswer.trim()) { setError("請先作答，再送出訂正。"); return; }
    const nextMessages: StudioMessage[] = [...quizMessages, { role: "student", text: quizAnswer.trim() }];
    setLoading(true); setError("");
    try {
      const response = await fetch("/api/teachers/pengli/coach", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode: "study-tool", studyTool: "quiz", messages: nextMessages, requestKey: crypto.randomUUID(), topic }) });
      const data = await response.json() as { reply?: string; source?: string; error?: string; saved?: boolean };
      if (!response.ok || !data.reply) throw new Error(data.error || "目前無法完成訂正。");
      const studentText = quizAnswer.trim();
      setQuizMessages([...nextMessages, { role: "coach", text: data.reply }]);
      setResult((current) => `${current}\n\n你的回答：${studentText}\n\n訂正與下一題：\n${data.reply}`);
      setQuizAnswer(""); setSource(data.source || source);
      setResultNote(data.saved ? "本次回答與訂正已自動保存到個人學習紀錄。" : "");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "目前無法完成訂正。"); }
    finally { setLoading(false); }
  }
  async function loadHistory() {
    const next = !showHistory; setShowHistory(next); if (!next || history.length) return;
    setHistoryLoading(true);
    try { const response = await fetch("/api/teachers/pengli/study-room"); const data = await response.json() as { rows?: StudyRun[] }; if (response.ok) setHistory(data.rows || []); }
    finally { setHistoryLoading(false); }
  }
  function speak() { if (!result || !("speechSynthesis" in window)) return; window.speechSynthesis.cancel(); const utterance = new SpeechSynthesisUtterance(result); utterance.lang = "zh-TW"; utterance.rate = .92; window.speechSynthesis.speak(utterance); }
  return <div className="studio-shell">
    <aside className="studio-tools" aria-label="八組學習範本">{tools.map((tool) => <button key={tool.id} className={active.id === tool.id ? "active" : ""} onClick={() => { setActive(tool); setResult(""); setError(""); setQuizMessages([]); setQuizAnswer(""); }}><small>{tool.no}</small><span><b>{tool.title}</b><em>{tool.description}</em></span></button>)}</aside>
    <section className="studio-workspace"><header><div><span>學習範本 {active.no}</span><h2>{active.title}</h2><p>{active.description}</p></div><div className="studio-header-actions">{!adminMode && <button className="published-toggle" onClick={() => void loadPublished(true)}>已發布教材{published.length ? ` ${published.length}` : ""}</button>}<button className="history-toggle" onClick={() => { setShowPublished(false); void loadHistory(); }}>{showHistory ? "返回學習工具" : "我的學習紀錄"}</button></div></header>{showPublished ? <section className="study-history published-library"><h3>老師已發布的學習內容</h3><p>直接開啟閱讀，不需再次產生，也不扣使用次數。</p>{publishedLoading ? <p>正在讀取…</p> : published.length ? published.map((item) => <button key={item.id} onClick={() => { const found = tools.find((tool) => tool.id === item.tool); if (found) setActive(found); setResult(item.content); setSource(item.sourceLabel); setResultNote("這是老師已審核發布的共用內容，本次不扣使用次數。"); setShowPublished(false); }}><b>{tools.find((tool) => tool.id === item.tool)?.title || item.tool}</b><span>{item.topic}</span><small>直接閱讀</small></button>) : <p>目前尚無已發布內容。</p>}</section> : showHistory ? <section className="study-history"><h3>最近自動保存的內容</h3>{historyLoading ? <p>正在讀取…</p> : history.length ? history.map((item) => <button key={item.id} onClick={() => { setResult(item.outputText); setSource(item.sourceLabel); setResultNote(item.cacheHit ? "當時由共用成果庫載入，未扣使用次數。" : "當時已自動保存。" ); setShowHistory(false); }}><b>{tools.find((tool) => tool.id === item.tool)?.title || item.tool}</b><span>{item.topic}</span><small>{new Date(item.createdAt).toLocaleString("zh-TW")}</small></button>) : <p>目前還沒有學習紀錄。</p>}</section> : <div className="studio-form">
      <label><span>教材主題</span><select value={topic} onChange={(event) => setTopic(event.target.value)}>{topics.map((item) => <option key={item}>{item}</option>)}</select></label>
      {(active.id === "explain" || active.id === "teach") && <label><span>想學的概念</span><input value={concept} onChange={(event) => setConcept(event.target.value)} placeholder="例如：行政處分的外部性" /></label>}
      {active.id === "teach" && <label><span>先用自己的話教一次</span><button type="button" className="template-fill" onClick={() => setAnswer(teachTemplate)}>套用說明範本</button><small className="field-help">範本只提供答題骨架，不會先透露教材答案，也不扣使用次數。</small><textarea value={answer} onChange={(event) => setAnswer(event.target.value)} placeholder="不要抄課本，直接說出你的理解…" rows={13} /></label>}
      {active.id === "mock" && <div className="exam-fields"><label><span>選擇題</span><input type="number" min="0" max="30" value={mc} onChange={(e) => setMc(Number(e.target.value))}/></label><label><span>簡答題</span><input type="number" min="0" max="10" value={short} onChange={(e) => setShort(Number(e.target.value))}/></label><label><span>申論題</span><input type="number" min="0" max="5" value={essay} onChange={(e) => setEssay(Number(e.target.value))}/></label><label><span>作答分鐘</span><input type="number" min="10" max="240" value={minutes} onChange={(e) => setMinutes(Number(e.target.value))}/></label></div>}
      {active.id === "audio" && <label><span>摘要長度</span><select value={minutes} onChange={(e) => setMinutes(Number(e.target.value))}><option value="5">約 5 分鐘</option><option value="10">約 10 分鐘</option><option value="15">約 15 分鐘</option></select></label>}
      <details className="prompt-template"><summary>查看本次學習範本</summary><pre>{prompt}</pre></details><button className="studio-run" onClick={run} disabled={loading}>{loading ? "正在依教材準備…" : active.id === "quiz" ? "開始第一題" : active.id === "teach" ? "請檢查我的說明" : `產生${active.title}`}</button>{error && <p className="studio-error">{error}</p>}
    </div>}{!showHistory && !showPublished && result && <article className="studio-result"><header><div><span>學習結果</span><h3>{active.title}</h3></div>{active.id === "audio" && <button onClick={speak}>播放語音</button>}</header>{resultNote && <p className="result-note">{resultNote}</p>}<StudyContent text={result} />{active.id === "quiz" && <div className="quiz-reply"><label><span>你的答案</span><textarea rows={4} value={quizAnswer} onChange={(event) => setQuizAnswer(event.target.value)} placeholder="先用自己的話回答這一題…" /></label><button onClick={answerQuiz} disabled={loading}>{loading ? "正在依教材批改…" : "送出並查看批改、解答與下一題"}</button><small>本次會依教材判斷答對、答錯與遺漏內容，並保存到個人學習紀錄。</small></div>}<small>依據：{source}</small></article>}</section>
  </div>;
}
