"use client";

import { useEffect, useMemo, useState } from "react";
import "./question-quality-review.css";

type Issue = {
  field: string;
  kind: string;
  severity: "P0" | "P1" | "P2";
  message: string;
  excerpt: string;
  autoFixable: boolean;
};

type QualityItem = {
  id: number;
  documentId: number;
  documentName: string;
  year: string;
  subject: string;
  questionNumber: string;
  issues: Issue[];
};

type Summary = {
  questionsScanned: number;
  questionsWithIssues: number;
  p0: number;
  p1: number;
  autoFixable: number;
};

type DocumentItem = {
  id: number;
  fileName: string;
  subject: string;
  questionCount: number;
};

type Question = {
  id: number;
  year: string;
  subject: string;
  questionNumber: string;
  stem: string;
  options: Record<string, string>;
  correctAnswer?: string | null;
  teacherAnswer?: string | null;
  explanation?: string;
  completeExplanation?: string;
  teacherCompleteExplanation?: string;
  aiCompleteExplanation?: string;
};

type Preview = {
  id: number;
  before: string;
  after: string;
};

const EMPTY_SUMMARY: Summary = {
  questionsScanned: 0,
  questionsWithIssues: 0,
  p0: 0,
  p1: 0,
  autoFixable: 0,
};

function plainText(value: string) {
  return String(value ?? "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function severityLabel(value: Issue["severity"]) {
  if (value === "P0") return "影響題意";
  if (value === "P1") return "結構風險";
  return "顯示問題";
}

function issueGroup(issue: Issue) {
  const text = `${issue.kind} ${issue.message} ${issue.field}`;
  if (/負號|比較|希臘|度數|箭頭|倍數|符號|方框|私人使用區|PUA/i.test(text)) return "特殊符號";
  if (/選項|題幹|答案/i.test(text)) return "題目結構";
  if (/解析|章節|頁首頁尾/i.test(text)) return "解析與章節";
  if (/圖|表格|公式/i.test(text)) return "圖表與公式";
  return "其他";
}

function parsePreview(value: string) {
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function changedFields(preview: Preview | null) {
  if (!preview) return [];
  const before = parsePreview(preview.before);
  const after = parsePreview(preview.after);
  const labels: Record<string, string> = {
    stem: "題幹",
    options: "選項",
    explanation: "簡要解析",
    completeExplanation: "完整解析",
    teacherCompleteExplanation: "老師完整解析",
    aiCompleteExplanation: "AI 完整解析",
  };
  return Object.keys(after)
    .filter((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]))
    .map((key) => ({ key, label: labels[key] ?? key, before: before[key], after: after[key] }));
}

export default function QuestionQualityReviewPage() {
  const [items, setItems] = useState<QualityItem[]>([]);
  const [summary, setSummary] = useState<Summary>(EMPTY_SUMMARY);
  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const [documentId, setDocumentId] = useState(0);
  const [severity, setSeverity] = useState("all");
  const [group, setGroup] = useState("all");
  const [query, setQuery] = useState("");
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [activeId, setActiveId] = useState(0);
  const [question, setQuestion] = useState<Question | null>(null);
  const [pdfPage, setPdfPage] = useState(1);
  const [pageMatched, setPageMatched] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  async function scan(preferredId?: number) {
    setLoading(true);
    try {
      const response = await fetch(
        `/api/medtech/admin/content-quality${documentId ? `?documentId=${documentId}` : ""}`,
        { cache: "no-store" },
      );
      const data = (await response.json()) as {
        summary?: Summary;
        items?: QualityItem[];
        documents?: DocumentItem[];
        error?: string;
      };
      if (!response.ok) throw new Error(data.error || "題庫品質掃描失敗");
      const unique = [...new Map((data.items ?? []).map((item) => [item.id, item])).values()];
      setItems(unique);
      setSummary(data.summary ?? EMPTY_SUMMARY);
      setDocuments(data.documents ?? []);
      setSelectedIds((current) => current.filter((id) => unique.some((item) => item.id === id)));
      const nextId = preferredId && unique.some((item) => item.id === preferredId)
        ? preferredId
        : activeId && unique.some((item) => item.id === activeId)
          ? activeId
          : unique[0]?.id ?? 0;
      setActiveId(nextId);
      if (!unique.length) {
        setQuestion(null);
        setPreview(null);
      }
      setNotice(`已檢查 ${data.summary?.questionsScanned ?? 0} 題，找到 ${unique.length} 題需要處理。`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "題庫品質掃描失敗");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void scan();
  }, [documentId]);

  useEffect(() => {
    if (!activeId) return;
    const item = items.find((entry) => entry.id === activeId);
    if (!item) return;
    setDetailLoading(true);
    setPreview(null);
    void Promise.all([
      fetch(`/api/medtech/admin/questions?id=${activeId}`, { cache: "no-store" }).then((response) => response.json()),
      fetch(`/api/medtech/admin/document-page?documentId=${item.documentId}&questionId=${activeId}`, { cache: "no-store" }).then((response) => response.json()),
    ])
      .then(([questionData, pageData]: [{ item?: Question; error?: string }, { page?: number; matched?: boolean }]) => {
        if (!questionData.item) throw new Error(questionData.error || "找不到題目內容");
        setQuestion(questionData.item);
        setPdfPage(pageData.page || 1);
        setPageMatched(pageData.matched === true);
      })
      .catch((error) => setNotice(error instanceof Error ? error.message : "題目載入失敗"))
      .finally(() => setDetailLoading(false));
  }, [activeId, items]);

  const groups = useMemo(
    () => [...new Set(items.flatMap((item) => item.issues.map(issueGroup)))].sort(),
    [items],
  );

  const filteredItems = useMemo(() => {
    const keyword = query.trim().toLocaleLowerCase();
    return items.filter((item) => {
      if (severity !== "all" && !item.issues.some((issue) => issue.severity === severity)) return false;
      if (group !== "all" && !item.issues.some((issue) => issueGroup(issue) === group)) return false;
      if (!keyword) return true;
      return `${item.year} ${item.subject} ${item.questionNumber} ${item.documentName} ${item.issues.map((issue) => `${issue.message} ${issue.excerpt}`).join(" ")}`
        .toLocaleLowerCase()
        .includes(keyword);
    });
  }, [items, severity, group, query]);

  const activeItem = items.find((item) => item.id === activeId) ?? null;
  const selectedFixableIds = [...new Set(selectedIds.filter((id) => items.find((item) => item.id === id)?.issues.some((issue) => issue.autoFixable)))];
  const previewChanges = changedFields(preview);

  function toggleSelected(id: number) {
    setSelectedIds((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);
  }

  function selectAllVisible() {
    const visible = filteredItems.map((item) => item.id);
    const allSelected = visible.length > 0 && visible.every((id) => selectedIds.includes(id));
    setSelectedIds((current) => allSelected
      ? current.filter((id) => !visible.includes(id))
      : [...new Set([...current, ...visible])]);
  }

  async function previewFix(ids: number[]) {
    if (!ids.length) return;
    setBusy(true);
    try {
      const response = await fetch("/api/medtech/admin/content-quality", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ questionIds: ids, dryRun: true }),
      });
      const data = (await response.json()) as { changed?: number; previews?: Preview[]; error?: string };
      if (!response.ok) throw new Error(data.error || "修復預覽失敗");
      if (ids.length === 1) setPreview(data.previews?.[0] ?? null);
      setNotice(`預覽完成：${data.changed ?? 0} 題會修改，目前尚未寫入資料庫。`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "修復預覽失敗");
    } finally {
      setBusy(false);
    }
  }

  async function applyFix(ids: number[]) {
    if (!ids.length) return;
    if (!window.confirm(`確定套用高信心符號規則到 ${ids.length} 題？無法確定的圖表、公式與章節內容不會自動猜測。`)) return;
    setBusy(true);
    try {
      const response = await fetch("/api/medtech/admin/content-quality", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ questionIds: ids, dryRun: false }),
      });
      const data = (await response.json()) as { changed?: number; error?: string };
      if (!response.ok) throw new Error(data.error || "高信心修復失敗");
      setNotice(`已修復 ${data.changed ?? 0} 題，正在重新檢查。`);
      setPreview(null);
      await scan(activeId);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "高信心修復失敗");
    } finally {
      setBusy(false);
    }
  }

  async function saveQuestion() {
    if (!question) return;
    setSaving(true);
    try {
      const response = await fetch("/api/medtech/admin/questions", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: question.id,
          year: question.year,
          subject: question.subject,
          questionNumber: question.questionNumber,
          stem: question.stem,
          options: question.options,
          teacherAnswer: question.teacherAnswer || question.correctAnswer || "",
          explanation: question.explanation || "",
        }),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(data.error || "題目儲存失敗");
      setNotice("本題已儲存；若原本已發布，系統會自動退回待校對狀態。正在重新掃描…");
      await scan(question.id);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "題目儲存失敗");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="quality-review-page">
      <header className="quality-review-topbar">
        <div>
          <a href="/medtech/admin?tab=questions">← 返回文件題庫</a>
          <span>MEDTECH QUESTION QA</span>
          <h1>題庫品質修復中心</h1>
          <p>逐題對照 PDF 原稿，修正會影響題意的符號、拆題與解析問題。</p>
        </div>
        <div className="quality-review-top-actions">
          <button type="button" disabled={busy || loading} onClick={() => void scan(activeId)}>
            {loading ? "掃描中…" : "重新掃描"}
          </button>
          <a href={activeItem ? `/medtech/admin/document-workspace?id=${activeItem.documentId}` : "/medtech/admin?tab=questions"}>
            完整文件工作區
          </a>
        </div>
      </header>

      <section className="quality-review-summary">
        <article><span>已掃描</span><strong>{summary.questionsScanned}</strong><small>題</small></article>
        <article className="danger"><span>異常題目</span><strong>{items.length}</strong><small>已去重</small></article>
        <article className="danger"><span>影響題意</span><strong>{summary.p0}</strong><small>P0</small></article>
        <article className="warning"><span>結構風險</span><strong>{summary.p1}</strong><small>P1</small></article>
        <article className="success"><span>可安全處理</span><strong>{summary.autoFixable}</strong><small>高信心項目</small></article>
      </section>

      <section className="quality-review-toolbar">
        <label>
          <span>文件</span>
          <select value={documentId} onChange={(event) => setDocumentId(Number(event.target.value))}>
            <option value={0}>全部醫檢文件</option>
            {documents.map((document) => <option key={document.id} value={document.id}>{document.fileName}（{document.questionCount} 題）</option>)}
          </select>
        </label>
        <label>
          <span>嚴重度</span>
          <select value={severity} onChange={(event) => setSeverity(event.target.value)}>
            <option value="all">全部</option>
            <option value="P0">P0 影響題意</option>
            <option value="P1">P1 結構風險</option>
            <option value="P2">P2 顯示問題</option>
          </select>
        </label>
        <label>
          <span>問題類型</span>
          <select value={group} onChange={(event) => setGroup(event.target.value)}>
            <option value="all">全部類型</option>
            {groups.map((value) => <option key={value}>{value}</option>)}
          </select>
        </label>
        <label className="quality-review-search">
          <span>搜尋</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="年度、題號、問題內容…" />
        </label>
        <div className="quality-review-batch">
          <button type="button" className="secondary" onClick={selectAllVisible}>選取目前結果</button>
          <button type="button" className="secondary" disabled={busy || !selectedFixableIds.length} onClick={() => void previewFix(selectedFixableIds)}>
            預覽 {selectedFixableIds.length || ""} 題
          </button>
          <button type="button" disabled={busy || !selectedFixableIds.length} onClick={() => void applyFix(selectedFixableIds)}>
            套用高信心修復
          </button>
        </div>
      </section>

      {notice && <p className="quality-review-notice" role="status" aria-live="polite">{notice}</p>}

      <section className="quality-review-workspace">
        <aside className="quality-review-queue">
          <header><div><b>待處理問題</b><span>{filteredItems.length} 題</span></div><small>勾選只用於批次高信心修復</small></header>
          <div className="quality-review-queue-list">
            {filteredItems.map((item) => {
              const highest = item.issues.some((issue) => issue.severity === "P0") ? "P0" : item.issues.some((issue) => issue.severity === "P1") ? "P1" : "P2";
              return (
                <article key={item.id} className={activeId === item.id ? "active" : ""}>
                  <label className="quality-review-check" title="加入批次處理">
                    <input type="checkbox" checked={selectedIds.includes(item.id)} onChange={() => toggleSelected(item.id)} />
                  </label>
                  <button type="button" onClick={() => setActiveId(item.id)}>
                    <div><strong>第 {item.questionNumber || "?"} 題</strong><span className={`severity ${highest.toLocaleLowerCase()}`}>{highest}</span></div>
                    <p>{item.year || "未標年份"} · {item.subject || "未分類"}</p>
                    <small>{item.issues[0]?.message}</small>
                    <em>{item.issues.length} 個問題{item.issues.some((issue) => issue.autoFixable) ? " · 含可修復項目" : " · 需人工核對"}</em>
                  </button>
                </article>
              );
            })}
            {!loading && !filteredItems.length && <div className="quality-review-empty">目前篩選條件下沒有待處理題目。</div>}
          </div>
        </aside>

        <section className="quality-review-detail">
          {!activeItem || !question ? (
            <div className="quality-review-empty large">{detailLoading ? "正在開啟題目與 PDF 原稿…" : "選擇左側題目開始校對。"}</div>
          ) : (
            <>
              <header className="quality-review-detail-head">
                <div>
                  <span>{activeItem.documentName}</span>
                  <h2>第 {question.questionNumber} 題 · {question.year} · {question.subject}</h2>
                  <small>{pageMatched ? `已定位 PDF 第 ${pdfPage} 頁` : `暫開 PDF 第 ${pdfPage} 頁，請人工確認位置`}</small>
                </div>
                <div>
                  {activeItem.issues.some((issue) => issue.autoFixable) && <button type="button" className="secondary" disabled={busy} onClick={() => void previewFix([activeItem.id])}>預覽自動修復</button>}
                  {activeItem.issues.some((issue) => issue.autoFixable) && <button type="button" disabled={busy} onClick={() => void applyFix([activeItem.id])}>套用本題建議</button>}
                </div>
              </header>

              <div className="quality-review-split">
                <section className="quality-review-pdf">
                  <header><b>PDF 原稿</b><span>第 {pdfPage} 頁</span></header>
                  <iframe title="PDF 原稿" src={`/api/medtech/admin/document-source?id=${activeItem.documentId}#page=${pdfPage}&zoom=page-width`} />
                </section>

                <section className="quality-review-editor">
                  <div className="quality-review-issues">
                    <header><b>系統偵測</b><span>{activeItem.issues.length} 項</span></header>
                    {activeItem.issues.map((issue, index) => (
                      <article key={`${issue.kind}-${index}`} className={issue.severity.toLocaleLowerCase()}>
                        <div><strong>{issue.severity} · {severityLabel(issue.severity)}</strong><span>{issueGroup(issue)}</span></div>
                        <p>{issue.message}</p>
                        <code>{issue.excerpt}</code>
                        <small>{issue.autoFixable ? "可套用高信心規則；套用前仍可先預覽差異。" : "不可自動猜測，請依左側 PDF 原稿人工校對。"}</small>
                      </article>
                    ))}
                  </div>

                  {preview && preview.id === activeItem.id && (
                    <section className="quality-review-diff">
                      <header><b>修復前後預覽</b><button type="button" onClick={() => setPreview(null)}>關閉</button></header>
                      {previewChanges.map((change) => (
                        <article key={change.key}>
                          <strong>{change.label}</strong>
                          <div><span>修復前</span><pre>{JSON.stringify(change.before, null, 2)}</pre></div>
                          <div className="after"><span>修復後</span><pre>{JSON.stringify(change.after, null, 2)}</pre></div>
                        </article>
                      ))}
                    </section>
                  )}

                  <section className="quality-review-form">
                    <header><div><b>目前題庫內容</b><span>修改後會退回待校對，不會直接覆蓋已發布版本</span></div><button type="button" disabled={saving} onClick={() => void saveQuestion()}>{saving ? "儲存中…" : "儲存本題"}</button></header>
                    <div className="quality-review-meta-fields">
                      <label><span>年度</span><input value={question.year} onChange={(event) => setQuestion({ ...question, year: event.target.value })} /></label>
                      <label><span>科目</span><input value={question.subject} onChange={(event) => setQuestion({ ...question, subject: event.target.value })} /></label>
                      <label><span>題號</span><input value={question.questionNumber} onChange={(event) => setQuestion({ ...question, questionNumber: event.target.value })} /></label>
                      <label><span>老師答案</span><select value={question.teacherAnswer || question.correctAnswer || ""} onChange={(event) => setQuestion({ ...question, teacherAnswer: event.target.value, correctAnswer: event.target.value || null })}><option value="">未確認</option>{["A", "B", "C", "D"].map((value) => <option key={value}>{value}</option>)}</select></label>
                    </div>
                    <label><span>題幹</span><textarea rows={5} value={plainText(question.stem)} onChange={(event) => setQuestion({ ...question, stem: event.target.value })} /></label>
                    <div className="quality-review-options">
                      {["A", "B", "C", "D"].map((key) => <label key={key}><span>選項 {key}</span><textarea rows={3} value={plainText(question.options?.[key] || "")} onChange={(event) => setQuestion({ ...question, options: { ...question.options, [key]: event.target.value } })} /></label>)}
                    </div>
                    <label><span>題目原有簡要解析</span><textarea rows={7} value={plainText(question.explanation || "")} onChange={(event) => setQuestion({ ...question, explanation: event.target.value })} /></label>
                  </section>
                </section>
              </div>
            </>
          )}
        </section>
      </section>
    </main>
  );
}
