"use client";

import { useEffect, useMemo, useState } from "react";

const topics = ["行政法理論基礎與行政組織法", "行政處分", "行政契約與行政命令", "行政罰法", "行政執行法", "訴願法與行政訴訟法", "國家賠償法與損失補償", "新進實務見解整理"];
const topicBatchTools = ["guide", "priority", "explain", "gaps", "audio"];
const tools = [
  { id: "guide", no: "01", title: "完整讀書指南", description: "完整整理全部爭點、核心概念、常見誤解與考題，建立教材地圖。", prompt: "用彭狸老師教材中的【{topic}】做一份完整讀書指南，依爭點分類。每個爭點包含：3 個核心概念、2 個常見誤解、2 道附解答的考題。只能根據教材，並標示依據頁碼。" },
  { id: "quiz", no: "02", title: "反過來考我", description: "從基礎題開始，一次只問一題；答完才訂正並提高難度。", prompt: "針對【{topic}】最重要的概念對我進行測驗。從基礎題開始，逐步提高難度。一次只能出一題，不要先公布答案；等我回答後，再依教材給回饋與說明，確認後才出下一題。" },
  { id: "priority", no: "03", title: "考前重點排序", description: "只挑前 5 大重點，依教材篇幅、重複程度與內容關聯排定衝刺順序。", prompt: "分析彭狸老師教材中的【{topic}】，整理最值得優先準備的 5 個考試爭點、為什麼重要，並為每個爭點各出一題高難度題。這是教材重點排序，不得宣稱能預測老師考題。" },
  { id: "explain", no: "04", title: "拆解看不懂的概念", description: "用類比、實際案例與常見誤解建立真正理解。", prompt: "請解釋【{concept}】，包含：一個容易理解的類比、一個行政法實際應用例子，以及一個最常見的錯誤理解。接著回到彭狸老師教材的正式用語與頁碼，最後只出一道題目考我。" },
  { id: "gaps", no: "05", title: "找出教材銜接缺口", description: "找出說明較少、前後銜接不足或需要補充才能理解的位置。", prompt: "請閱讀【{topic}】教材，找出其中說明較少或前後銜接不完整的概念，指出哪些部分需要額外補充才能理解，並提供簡短補充。必須區分教材原文與補充說明，不得把補充冒充成彭狸老師見解。" },
  { id: "mock", no: "06", title: "完整模擬考", description: "自訂選擇題、簡答題、申論題與考試時間。", prompt: "請依據【{topic}】出一份完整模擬考卷，包含 {mc} 題選擇題、{short} 題簡答題與 {essay} 題申論題，建議作答時間 {minutes} 分鐘。先只顯示試卷；答案、解析與申論評分重點另列在卷末。" },
  { id: "audio", no: "07", title: "通勤語音摘要", description: "先產生適合聆聽的複習稿，再由裝置朗讀。", prompt: "請把【{topic}】整理成適合通勤聆聽的繁體中文語音摘要稿，聚焦核心爭點，針對容易混淆的概念多做說明。這是複習內容，不適合作為第一次學習。控制在約 {minutes} 分鐘可聽完。" },
] as const;
type Tool = typeof tools[number];
type StudioMessage = { role: "student" | "coach"; text: string };
type StudyRun = { id: number; tool: string; topic: string; outputText: string; sourceLabel: string; cacheHit: boolean; createdAt: string };
type PublishedArtifact = { id: number; tool: string; topic: string; content: string; sourceLabel: string; audioUrl?: string | null; reviewStatus?: string; updatedAt: string };

function StudyContent({ text }: { text: string }) {
  const lines = text
    .split("\n")
    .map((line) => line.replace(/^[¬↵⏎↩]+\s*/gu, "").replace(/\s*[¬↵⏎↩]+$/gu, "").trim())
    .filter(Boolean);
  return <div className="study-content">{lines.map((line, index) => {
    if (/^[=─—－-]{3,}$/u.test(line)) return <hr key={index} />;
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
  const [mc, setMc] = useState(5), [short, setShort] = useState(2), [essay, setEssay] = useState(1), [minutes, setMinutes] = useState(30);
  const [batchCount, setBatchCount] = useState(5);
  const [batchScope, setBatchScope] = useState("current");
  const [result, setResult] = useState(""), [source, setSource] = useState(""), [error, setError] = useState(""), [loading, setLoading] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [quizAnswer, setQuizAnswer] = useState("");
  const [quizMessages, setQuizMessages] = useState<StudioMessage[]>([]);
  const [resultNote, setResultNote] = useState("");
  const [history, setHistory] = useState<StudyRun[]>([]), [showHistory, setShowHistory] = useState(false), [historyLoading, setHistoryLoading] = useState(false);
  const [published, setPublished] = useState<PublishedArtifact[]>([]), [showPublished, setShowPublished] = useState(false), [publishedLoading, setPublishedLoading] = useState(false);
  async function loadPublished(open = true) {
    if (open && !adminMode) { setShowPublished(true); setShowHistory(false); }
    setPublishedLoading(true);
    try {
      const response = await fetch(adminMode ? "/api/admin/pengli-study-artifacts" : "/api/teachers/pengli/study-room/published", { cache: "no-store" });
      const data = await response.json() as { rows?: PublishedArtifact[] };
      if (response.ok) setPublished(data.rows || []);
    } finally { setPublishedLoading(false); }
  }
  useEffect(() => { void loadPublished(false); }, [adminMode]);
  useEffect(() => {
    if (!adminMode) return;
    const refresh = () => void loadPublished(false);
    window.addEventListener("pengli-artifacts-updated", refresh);
    return () => window.removeEventListener("pengli-artifacts-updated", refresh);
  }, [adminMode]);
  const currentArtifact = published.find((item) => item.tool === active.id && item.topic === topic);
  const makePrompt = (targetTopic: string) => active.prompt.replaceAll("{topic}", targetTopic).replaceAll("{concept}", concept.trim() || `「${targetTopic}」中最重要的概念`).replaceAll("{mc}", String(mc)).replaceAll("{short}", String(short)).replaceAll("{essay}", String(essay)).replaceAll("{minutes}", String(minutes));
  const prompt = useMemo(() => makePrompt(topic), [active, topic, concept, mc, short, essay, minutes]);
  const topicBatchEnabled = adminMode && topicBatchTools.includes(active.id);
  const canGenerateAlongsideExisting = active.id === "quiz" || active.id === "mock" || (topicBatchEnabled && batchScope !== "current" && !(active.id === "explain" && concept.trim()));
  async function run() {
    if (!adminMode && active.id !== "mock") { setError("這項內容由老師後台整理發布，請從「免費學習內容」直接開啟。"); return; }
    if (active.id === "mock" && mc + short + essay < 1) { setError("請至少設定一題選擇題、簡答題或申論題。"); return; }
    if (active.id === "mock" && mc + short + essay > 10) { setError("每份模擬考最多 10 題，能兼顧生成品質與去除重複。"); return; }
    if (active.id === "mock" && minutes < 10) { setError("完整模擬考的作答時間至少需設定 10 分鐘。"); return; }
    setLoading(true); setError(""); setResult(""); setSource(""); setAudioUrl(null);
    try {
      const missingTopics = topics.filter((item) => !published.some((artifact) => artifact.tool === active.id && artifact.topic === item));
      const targetTopics = topicBatchEnabled && batchScope !== "current" && !(active.id === "explain" && concept.trim())
        ? (batchScope === "missing5" ? missingTopics.slice(0, 5) : missingTopics)
        : [topic];
      if (!targetTopics.length) throw new Error("這個範本的所有教材主題都已經產生完成，不需要重複生成。");
      const total = adminMode && (active.id === "quiz" || active.id === "mock") ? batchCount : targetTopics.length;
      const generated: Array<{ topic: string; text: string }> = [];
      let latestSource = "彭狸老師教材";
      let latestData: { cached?: boolean; saved?: boolean } = {};
      const existing = published.filter((item) => item.tool === "quiz" && item.topic === topic).map((item) => item.content.slice(0, 180));
      for (let index = 0; index < total; index += 1) {
        const targetTopic = active.id === "quiz" ? topic : targetTopics[index];
        const excluded = [...existing, ...generated.map((item) => item.text.slice(0, 180))];
        const itemPrompt = makePrompt(targetTopic);
        const batchPrompt = adminMode && (active.id === "quiz" || active.id === "mock")
          ? `${itemPrompt}\n\n【後台批次${active.id === "mock" ? "產生模擬考" : "出題"}】這是第 ${index + 1} 份，共 ${total} 份。核心題目不得與下列既有內容重複，也不得只替換人名、數字或選項順序：\n${excluded.length ? excluded.map((item, itemIndex) => `${itemIndex + 1}. ${item}`).join("\n") : "目前沒有既有內容。"}`
          : itemPrompt;
        const retrievalMode = active.id === "explain" && concept.trim() ? "keyword" : "theme";
        const response = await fetch("/api/teachers/pengli/coach", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode: "study-tool", studyTool: active.id, retrievalMode, forceNew: !adminMode && active.id === "mock", examConfig: active.id === "mock" ? { mc, short, essay, minutes } : undefined, messages: [{ role: "student", text: batchPrompt }], requestKey: crypto.randomUUID(), topic: targetTopic }) });
        const data = await response.json() as { reply?: string; source?: string; error?: string; cached?: boolean; saved?: boolean };
        if (!response.ok || !data.reply) throw new Error(`${generated.length ? `已完成 ${generated.length} 份；` : ""}${targetTopic}：${data.error || "目前無法產生學習內容。"}`);
        generated.push({ topic: targetTopic, text: data.reply }); latestSource = data.source || latestSource; latestData = data;
      }
      const combined = generated.map((item, index) => total > 1 ? active.id === "quiz" ? `【第 ${index + 1} 題】\n${item.text}` : `【${item.topic}】\n${item.text}` : item.text).join("\n\n---\n\n");
      setResult(combined); setSource(latestSource);
      setResultNote(total > 1 ? `已依序完成 ${generated.length} ${active.id === "quiz" ? "題" : active.id === "mock" ? "份模擬考" : "個教材主題"}，每份均已分開存入成果庫並列為待審核。` : latestData.cached ? "已從免費共用成果庫載入，本次不扣生成次數。" : latestData.saved ? (adminMode ? "已存入成果庫並列為待審核；請在上方確認後發布到前台。" : "這份模擬考已保存；本次扣 1 次生成額度，之後可不限次數練習。") : "");
      if (adminMode) {
        void loadPublished(false);
        window.dispatchEvent(new Event("pengli-artifact-generated"));
      }
      if (active.id === "quiz" && total === 1) setQuizMessages([{ role: "student", text: prompt }, { role: "coach", text: generated[0].text }]);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "目前無法產生學習內容。"); }
    finally { setLoading(false); }
  }
  async function answerQuiz() {
    if (!quizAnswer.trim()) { setError("請先作答，再送出訂正。"); return; }
    const nextMessages: StudioMessage[] = [...quizMessages, { role: "student", text: quizAnswer.trim() }];
    setLoading(true); setError("");
    try {
      const response = await fetch("/api/teachers/pengli/coach", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode: "study-tool", studyTool: "quiz", retrievalMode: "keyword", messages: nextMessages, requestKey: crypto.randomUUID(), topic }) });
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
  return <div className="studio-shell">
    <aside className="studio-tools" aria-label="七組學習範本">{tools.map((tool) => { const artifact = published.find((item) => item.tool === tool.id && item.topic === topic); return <button key={tool.id} className={active.id === tool.id ? "active" : ""} onClick={() => { setActive(tool); setResult(""); setAudioUrl(null); setError(""); setQuizMessages([]); setQuizAnswer(""); }}><small>{tool.no}</small><span><b>{tool.title}{adminMode && artifact && <i className={artifact.reviewStatus === "published" ? "published" : "pending"}>{artifact.reviewStatus === "published" ? "已發布" : "待審核"}</i>}</b><em>{tool.description}</em></span></button>; })}</aside>
    <section className="studio-workspace"><header><div><span>學習範本 {active.no}</span><h2>{active.title}</h2><p>{active.description}</p></div>{!adminMode && <div className="studio-header-actions"><button className="published-toggle" onClick={() => void loadPublished(true)}>免費學習內容{published.length ? ` ${published.length}` : ""}</button><button className="history-toggle" onClick={() => { setShowPublished(false); void loadHistory(); }}>{showHistory ? "返回學習工具" : "我的模擬考"}</button></div>}</header>{showPublished ? <section className="study-history published-library"><h3>老師預先發布的免費內容</h3><p>直接開啟閱讀、練習或收聽完成的語音成品，不扣生成次數。</p>{publishedLoading ? <p>正在讀取…</p> : published.length ? published.map((item) => <button key={item.id} onClick={() => { const found = tools.find((tool) => tool.id === item.tool); if (found) setActive(found); setResult(item.content); setAudioUrl(item.audioUrl || null); setSource(item.sourceLabel); setResultNote(item.tool === "audio" ? item.audioUrl ? "這是老師完成並發布的語音成品，可直接收聽。" : "這份語音稿尚未上傳音檔。" : "這是老師預先發布的免費內容，本次不扣生成次數。"); setShowPublished(false); }}><b>{tools.find((tool) => tool.id === item.tool)?.title || item.tool}</b><span>{item.topic}</span><small>{item.tool === "audio" ? item.audioUrl ? "播放成品" : "尚無音檔" : "免費開啟"}</small></button>) : <p>目前尚無已發布內容。</p>}</section> : showHistory ? <section className="study-history"><h3>我的模擬考</h3><p>生成只扣一次；已保存的試卷可不限次數重新練習。</p>{historyLoading ? <p>正在讀取…</p> : history.filter((item) => item.tool === "mock").length ? history.filter((item) => item.tool === "mock").map((item) => <button key={item.id} onClick={() => { setActive(tools.find((tool) => tool.id === "mock")!); setResult(item.outputText); setAudioUrl(null); setSource(item.sourceLabel); setResultNote("這份模擬考已保存，可不限次數練習，不再扣生成次數。" ); setShowHistory(false); }}><b>完整模擬考</b><span>{item.topic}</span><small>{new Date(item.createdAt).toLocaleString("zh-TW")}</small></button>) : <p>目前還沒有自己產生的模擬考。</p>}</section> : <div className="studio-form">
      <label><span>教材主題</span><select value={topic} onChange={(event) => setTopic(event.target.value)}>{topics.map((item) => <option key={item}>{item}</option>)}</select></label>
      {active.id === "explain" && <label><span>想學的概念</span><input value={concept} onChange={(event) => setConcept(event.target.value)} placeholder="例如：行政處分的外部性" /></label>}
      {active.id === "mock" && <><div className="exam-fields"><label><span>選擇題</span><input type="number" min="0" max="10" value={mc} onChange={(e) => setMc(Number(e.target.value))}/></label><label><span>簡答題</span><input type="number" min="0" max="10" value={short} onChange={(e) => setShort(Number(e.target.value))}/></label><label><span>申論題</span><input type="number" min="0" max="5" value={essay} onChange={(e) => setEssay(Number(e.target.value))}/></label><label><span>作答分鐘</span><input type="number" min="10" max="240" value={minutes} onChange={(e) => setMinutes(Number(e.target.value))}/></label></div><small className="field-help">每份合計最多 10 題。建議 5 題選擇、2 題簡答、1 題申論，品質與練習時間較合適。</small></>}
      {active.id === "audio" && <label><span>摘要長度</span><select value={minutes} onChange={(e) => setMinutes(Number(e.target.value))}><option value="5">約 5 分鐘</option><option value="10">約 10 分鐘</option><option value="15">約 15 分鐘</option></select></label>}
      {adminMode && active.id === "quiz" && <label><span>批次出題數量</span><select value={batchCount} onChange={(event) => setBatchCount(Number(event.target.value))}><option value="1">1 題</option><option value="5">5 題（建議）</option><option value="10">10 題</option></select><small className="field-help">系統會依序逐題生成、分開保存，並排除本主題既有題目。</small></label>}
      {adminMode && active.id === "mock" && <label><span>免費模擬考預產數量</span><select value={batchCount} onChange={(event) => setBatchCount(Number(event.target.value))}><option value="1">1 份</option><option value="5">5 份（建議）</option><option value="10">10 份</option></select><small className="field-help">每份會分開保存並排除既有題目，審核發布後供所有同學免費練習。</small></label>}
      {topicBatchEnabled && <label><span>批次處理範圍</span><select value={batchScope} onChange={(event) => setBatchScope(event.target.value)}><option value="current">只產生目前主題</option><option value="missing5">產生尚未完成的 5 個主題（建議）</option><option value="all">產生全部尚未完成主題</option></select><small className="field-help">已有待審核或已發布成果的主題會自動跳過。{active.id === "explain" ? "若輸入指定概念，則只處理目前主題。" : ""}</small></label>}
      <details className="prompt-template"><summary>查看本次學習範本</summary><pre>{prompt}</pre></details>{!adminMode && active.id !== "mock" && <div className="admin-artifact-state published"><b>此功能使用老師預先發布的內容</b><span>請按右上角「免費學習內容」開啟，不需另外生成，也不扣次數。</span></div>}{adminMode && currentArtifact && <div className={`admin-artifact-state ${currentArtifact.reviewStatus === "published" ? "published" : "pending"}`}><b>{currentArtifact.reviewStatus === "published" ? "此主題已有已發布內容" : "此主題已有內容，尚待審核"}</b><span>{active.id === "quiz" || active.id === "mock" ? "可繼續批次產生不重複內容；每份會分開存入待審核清單。" : canGenerateAlongsideExisting ? "目前主題會跳過，系統將依序處理其他尚未完成的教材主題。" : currentArtifact.reviewStatus === "published" ? "學生前台已可直接閱讀，不需要再次產生。" : "請先查看內容，再到上方成果發布管理進行發布。"}</span></div>}{adminMode && currentArtifact && !canGenerateAlongsideExisting ? <button className="studio-run existing" onClick={() => { setResult(currentArtifact.content); setSource(currentArtifact.sourceLabel); setResultNote(currentArtifact.reviewStatus === "published" ? "此內容已發布到學生前台。" : "此內容尚待審核，尚未出現在學生前台。"); }}>{currentArtifact.reviewStatus === "published" ? "查看已發布內容" : "查看待審內容"}</button> : (adminMode || active.id === "mock") && <button className="studio-run" onClick={run} disabled={loading}>{loading ? adminMode && (active.id === "quiz" || active.id === "mock") ? "正在依序產生不重複內容…" : topicBatchEnabled && batchScope !== "current" ? "正在依序處理教材主題…" : "正在依教材準備…" : active.id === "quiz" && adminMode ? `批次產生 ${batchCount} 題` : active.id === "mock" ? adminMode ? `批次預產 ${batchCount} 份免費模擬考` : "產生新的模擬考（扣 1 次）" : topicBatchEnabled && batchScope !== "current" && !(active.id === "explain" && concept.trim()) ? batchScope === "all" ? "批次產生全部未完成主題" : "批次產生 5 個未完成主題" : `產生${active.title}`}</button>}{error && <p className="studio-error">{error}</p>}
    </div>}{!showHistory && !showPublished && result && <article className="studio-result"><header><div><span>學習結果</span><h3>{active.title}</h3></div>{adminMode && active.id === "audio" && <button onClick={() => void navigator.clipboard.writeText(result)}>複製語音稿</button>}</header>{resultNote && <p className="result-note">{resultNote}</p>}{active.id === "audio" && !adminMode && (audioUrl ? <audio className="studio-audio-player" controls preload="metadata" src={audioUrl}>你的瀏覽器不支援音訊播放。</audio> : <p className="studio-audio-notice">這份內容尚未完成音檔，請改選其他已發布的語音摘要。</p>)}{(active.id !== "audio" || adminMode) && <StudyContent text={result} />}{adminMode && active.id === "quiz" && <div className="quiz-reply"><label><span>測試答案</span><textarea rows={4} value={quizAnswer} onChange={(event) => setQuizAnswer(event.target.value)} placeholder="輸入答案測試批改流程…" /></label><button onClick={answerQuiz} disabled={loading}>{loading ? "正在依教材批改…" : "送出測試"}</button></div>}<small>依據：{source}</small></article>}</section>
  </div>;
}
