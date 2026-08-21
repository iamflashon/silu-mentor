"use client";

import { useEffect, useMemo, useState } from "react";

type Source = { id: number; label: string; url: string; examType: string; status: string; discoveredCount: number; processedCount: number; questionCount: number; lastError: string | null };
type SourceItem = { id: number; fileUrl: string; title: string; year: string; examName: string; subject: string; status: string; questionCount: number; actualQuestionCount: number; error: string | null; missingQuestionNumbers: number[] };
type Question = { id: number; sourceUrl: string; examType: string; year: string; examName: string; subject: string; questionNumber: string; stem: string; options: Record<string, string>; correctAnswer: string | null; explanation: string; teacherAnswer: string; teacherNotes: string; rubric: Array<{ criterion?: string; points?: string; must_include?: string }>; answerSource: string; answerStatus: string; status: string; reviewStatus: string };

export default function SourceQuestionWorkspace({ sourceId }: { sourceId: number }) {
  const [source, setSource] = useState<Source | null>(null);
  const [items, setItems] = useState<SourceItem[]>([]);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [selectedItemId, setSelectedItemId] = useState(0);
  const [selectedQuestionId, setSelectedQuestionId] = useState(0);
  const [notice, setNotice] = useState("正在載入來源題庫…");
  const [retrying, setRetrying] = useState(false);

  async function load(preferredItemId?: number) {
    const response = await fetch(`/api/exam-sources/workspace?sourceId=${sourceId}`, { cache: "no-store" });
    const data = await response.json() as { source?: Source; items?: SourceItem[]; questions?: Question[]; error?: string };
    if (!response.ok) { setNotice(data.error ?? "無法讀取來源題庫"); return; }
    const nextItems = data.items ?? [];
    setSource(data.source ?? null);
    setItems(nextItems);
    setQuestions(data.questions ?? []);
    const preferred = nextItems.find((item) => item.id === preferredItemId)
      ?? nextItems.find((item) => item.status === "failed")
      ?? nextItems[0];
    setSelectedItemId(preferred?.id ?? 0);
    setNotice("");
  }

  useEffect(() => { if (sourceId > 0) void load(); else setNotice("缺少來源編號"); }, [sourceId]);
  const selectedItem = items.find((item) => item.id === selectedItemId) ?? null;
  const selectedQuestions = useMemo(() => questions.filter((question) => question.sourceUrl === selectedItem?.fileUrl), [questions, selectedItem?.fileUrl]);
  const selectedQuestion = selectedQuestions.find((question) => question.id === selectedQuestionId) ?? selectedQuestions[0] ?? null;
  const failedCount = items.filter((item) => item.status === "failed").length;
  const emptyCount = items.filter((item) => item.status === "review" && item.actualQuestionCount === 0).length;

  async function retryFailed() {
    setRetrying(true);
    setNotice("正在重試下一份失敗或尚未處理的 PDF…");
    const response = await fetch("/api/exam-sources/process", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sourceId }) });
    const data = await response.json() as { message?: string; error?: string };
    setNotice(response.ok ? data.message ?? "重試完成" : data.error ?? "重試失敗");
    await load(selectedItemId);
    setRetrying(false);
  }

  return <main className="source-question-workspace">
    <header className="source-question-workspace-header">
      <div><a href="/admin/question-bank">← 返回總題庫管理</a><h1>{source?.examType === "essay" ? "申論題擷取與擬答管理" : "選擇題擷取管理"}</h1><p>{source?.label ?? "來源題庫"} · 左側原始 PDF，右側逐題核對</p></div>
      <div><span>已處理 {source?.processedCount ?? 0}／{source?.discoveredCount ?? 0} 份 · 共 {(source?.questionCount ?? 0).toLocaleString()} 題</span><button type="button" disabled={retrying || (!failedCount && !items.some((item) => item.status === "waiting"))} onClick={() => void retryFailed()}>{retrying ? "重試中…" : `重試失敗／待處理（${failedCount}）`}</button></div>
    </header>
    {(notice || source?.lastError) && <div className={`source-workspace-notice ${source?.lastError ? "error" : ""}`}>{notice || source?.lastError}</div>}
    <section className="source-workspace-summary">
      <div><b>{items.length}</b><span>來源 PDF</span></div><div><b>{items.filter((item) => item.status === "review").length}</b><span>完成拆題</span></div><div className={failedCount ? "danger" : ""}><b>{failedCount}</b><span>處理失敗</span></div><div className={emptyCount ? "danger" : ""}><b>{emptyCount}</b><span>完成但零題</span></div>
    </section>
    <section className="source-workspace-body">
      <aside className="source-pdf-pane">
        <header><div><b>原始 PDF</b><span>{selectedItem ? `${selectedItem.year} · ${selectedItem.title}` : "請選擇來源"}</span></div>{selectedItem && <a href={selectedItem.fileUrl} target="_blank" rel="noreferrer">另開 PDF</a>}</header>
        {selectedItem ? <>{selectedItem.error && <div className="source-pdf-error">{selectedItem.error}</div>}<iframe key={selectedItem.id} src={selectedItem.fileUrl} title={`${selectedItem.year} ${selectedItem.title} PDF`} /></> : <div className="source-workspace-empty">尚未找到來源 PDF。</div>}
      </aside>
      <aside className="source-question-pane">
        <header><div><b>擷取題組與題目</b><span>{selectedItem ? `${selectedItem.actualQuestionCount} 題` : "—"}</span></div>{selectedItem?.missingQuestionNumbers.length ? <em>疑似缺題：{selectedItem.missingQuestionNumbers.join("、")}</em> : null}</header>
        <div className="source-item-list">{items.map((item) => <button type="button" className={item.id === selectedItemId ? "active" : ""} key={item.id} onClick={() => { setSelectedItemId(item.id); setSelectedQuestionId(0); }}><span className={`status ${item.status}`}>{item.status === "review" ? "完成" : item.status === "failed" ? "失敗" : item.status === "extracting" ? "擷取中" : "待處理"}</span><div><b>{item.year} · {item.title}</b><small>{item.examName} · {item.actualQuestionCount} 題{item.error ? ` · ${item.error}` : ""}</small></div></button>)}</div>
        <div className="source-question-list">{selectedQuestions.map((question) => <button type="button" className={question.id === selectedQuestion?.id ? "active" : ""} key={question.id} onClick={() => setSelectedQuestionId(question.id)}><b>第 {question.questionNumber} 題</b><span>{question.stem.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim()}</span><small>{question.subject} · {question.status === "published" ? "已發布" : "草稿"}</small></button>)}{selectedItem && !selectedQuestions.length && <div className="source-workspace-empty">這份 PDF 尚未擷取出題目；請查看左側原稿與錯誤訊息。</div>}</div>
        {selectedQuestion && <article className={`source-question-detail ${source?.examType === "essay" ? "essay" : "mcq"}`}><header><b>第 {selectedQuestion.questionNumber} 題完整內容</b><a href={`/admin/question-bank?view=questions&category=law&questionId=${selectedQuestion.id}`}>進入題目總編輯</a></header><section className="source-question-stem"><h2>題目</h2><p>{selectedQuestion.stem}</p></section>{source?.examType === "essay" ? <div className="essay-reference-fields"><section><h2>老師參考擬答</h2><small>{selectedQuestion.answerSource || "高點名師參考擬答"}</small>{selectedQuestion.teacherAnswer ? <p>{selectedQuestion.teacherAnswer}</p> : <p className="missing-content">原始 PDF 尚未擷取到老師擬答。</p>}</section><section><h2>試題評析／考點命中</h2>{selectedQuestion.teacherNotes ? <p>{selectedQuestion.teacherNotes}</p> : <p className="missing-content">原始 PDF 未附評析，或尚未成功擷取。</p>}</section><section><h2>評分重點</h2>{selectedQuestion.rubric?.length ? <ol>{selectedQuestion.rubric.map((item, index) => <li key={index}><b>{item.criterion || `重點 ${index + 1}`}</b><span>{item.must_include}</span>{item.points && <em>{item.points}</em>}</li>)}</ol> : <p className="missing-content">尚未整理出評分重點。</p>}</section></div> : <><div className="source-option-list">{Object.entries(selectedQuestion.options ?? {}).map(([label, optionText]) => <div key={label}><b>{label}</b><span>{optionText}</span></div>)}</div><section className="source-answer-field"><h2>答案與解析</h2><b>{selectedQuestion.correctAnswer || "尚未擷取答案"}</b>{selectedQuestion.explanation && <p>{selectedQuestion.explanation}</p>}</section></>}</article>}
      </aside>
    </section>
  </main>;
}
