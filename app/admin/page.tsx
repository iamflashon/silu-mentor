"use client";

import Link from "next/link";
import { FormEvent, useEffect, useRef, useState } from "react";

type Uploaded = { id: number; name: string; subject: string; size: string; status: string; error?: string | null };
type QueueItem = { key: string; file: File; status: "queued" | "uploading" | "indexing" | "done" | "failed"; progress: number; error?: string };
type UsageData = {
  totals: { requests: number; inputTokens: number; cachedTokens: number; outputTokens: number; fileSearchCalls: number; costMicros: number };
  recent: Array<{ id: number; model: string; source: string; inputTokens: number; cachedTokens: number; outputTokens: number; fileSearchCalls: number; estimatedCostUsdMicros: number; createdAt: string }>;
  showCosts: boolean;
};
type ExamSource = { id: number; url: string; label: string; examType: string; sourceKind: string; status: string; discoveredCount: number; processedCount: number; questionCount: number; lastError?: string | null };
type ExamProcessResult = { status?: string; processedCount?: number; discoveredCount?: number; questionCount?: number; message?: string; error?: string };
type DocumentStats = { total: number; ready: number; indexedBytes: number; citations: number; misses: number; indexVersion: string };
type LearningResource = { id: number; resourceType: string; title: string; subject: string; creator: string; description: string; documentId: number | null; sourceUrl: string; accessType: string; status: string; hasCover: number; segmentCount: number };
const DOCUMENTS_PER_PAGE = 5;
const USAGE_PER_PAGE = 10;

async function readJson(response: Response) {
  const text = await response.text();
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    if (response.status === 413) return { error: "檔案超過單次上傳限制，請重新選擇文件" };
    return { error: "伺服器暫時無法處理這份文件" };
  }
}

export default function AdminPage() {
  const [activeTab, setActiveTab] = useState<"documents" | "resources" | "courses" | "magazine" | "sources" | "costs">("documents");
  const fileRef = useRef<HTMLInputElement>(null);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [subject, setSubject] = useState("刑法");
  const [type, setType] = useState("教科書");
  const [files, setFiles] = useState<Uploaded[]>([]);
  const [documentPage, setDocumentPage] = useState(1);
  const [documentStats, setDocumentStats] = useState<DocumentStats>({ total: 0, ready: 0, indexedBytes: 0, citations: 0, misses: 0, indexVersion: "待建立" });
  const [uploading, setUploading] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [notice, setNotice] = useState("");
  const [usage, setUsage] = useState<UsageData | null>(null);
  const [usagePage, setUsagePage] = useState(1);
  const [examSources, setExamSources] = useState<ExamSource[]>([]);
  const [sourceUrl, setSourceUrl] = useState("");
  const [sourceLabel, setSourceLabel] = useState("");
  const [sourceExamType, setSourceExamType] = useState("mcq");
  const [sourceKind, setSourceKind] = useState("exam");
  const [processingSourceId, setProcessingSourceId] = useState<number | null>(null);
  const [batchSourceId, setBatchSourceId] = useState<number | null>(null);
  const batchStopRef = useRef(false);
  const [resources, setResources] = useState<LearningResource[]>([]);
  const [resourceType, setResourceType] = useState("book");
  const [resourceTitle, setResourceTitle] = useState("");
  const [resourceCreator, setResourceCreator] = useState("");
  const [resourceUrl, setResourceUrl] = useState("");
  const [resourceDocumentId, setResourceDocumentId] = useState("");
  const [magazineUrl, setMagazineUrl] = useState("https://www.angle.com.tw/magazine/m_search.asp?KindID=12");

  useEffect(() => {
    fetch("/api/documents").then(async (response) => {
      if (!response.ok) return;
      const result = await response.json() as { documents?: Array<{ id: number; name: string; subject: string; type: string; sizeBytes: number; status: string; error?: string | null }>; stats?: DocumentStats };
      setFiles((result.documents ?? []).map((item) => ({
        id: item.id,
        name: item.name,
        subject: item.subject,
        size: `${(item.sizeBytes / 1024 / 1024).toFixed(1)} MB · ${item.type}`,
        status: item.status,
        error: item.error,
      })));
      if (result.stats) setDocumentStats(result.stats);
    }).catch(() => undefined);
    fetch("/api/usage").then(async (response) => {
      if (response.ok) setUsage(await response.json() as UsageData);
    }).catch(() => undefined);
    fetch("/api/exam-sources").then(async (response) => { if (response.ok) setExamSources(((await response.json()) as { sources?: ExamSource[] }).sources ?? []); }).catch(() => undefined);
    fetch("/api/resources").then(async (response) => { if (response.ok) setResources(((await response.json()) as { resources?: LearningResource[] }).resources ?? []); }).catch(() => undefined);
  }, []);

  async function addResource(event: FormEvent) {
    event.preventDefault();
    const selectedType = activeTab === "courses" ? "course" : activeTab === "resources" ? "book" : resourceType;
    const response = await fetch("/api/resources", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ resourceType: selectedType, title: resourceTitle, subject: "刑法", creator: resourceCreator, sourceUrl: resourceUrl, documentId: resourceDocumentId || null, accessType: selectedType === "course" ? "full" : "owned" }) });
    const result = await readJson(response) as { resource?: LearningResource; error?: string };
    if (!response.ok || !result.resource) { setNotice(result.error ?? "無法建立學習資源"); return; }
    setResources((current) => [result.resource!, ...current]); setResourceTitle(""); setResourceCreator(""); setResourceUrl(""); setResourceDocumentId(""); setNotice("學習資源已建立，可繼續上傳書封或字幕。");
  }

  async function uploadResourceAsset(resourceId: number, assetType: "cover" | "subtitle", file?: File) {
    if (!file) return;
    const form = new FormData(); form.set("resourceId", String(resourceId)); form.set("assetType", assetType); form.set("file", file);
    setNotice(assetType === "cover" ? "正在上傳書封…" : "正在解析字幕並建立可搜尋時間片段…");
    const response = await fetch("/api/resources/assets", { method: "POST", body: form });
    const result = await readJson(response) as { segments?: number; error?: string };
    if (!response.ok) { setNotice(result.error ?? "檔案處理失敗"); return; }
    setResources((current) => current.map((item) => item.id === resourceId ? { ...item, hasCover: assetType === "cover" ? 1 : item.hasCover, segmentCount: assetType === "subtitle" ? item.segmentCount + Number(result.segments ?? 0) : item.segmentCount } : item));
    setNotice(assetType === "cover" ? "書封已更新。" : `字幕已完成，建立 ${result.segments ?? 0} 個可搜尋時間片段。`);
  }

  async function analyzeMagazine() {
    setNotice("正在分析最新一期、試讀文章與可用連結…");
    const response = await fetch("/api/resources/magazine-import", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url: magazineUrl }) });
    const result = await readJson(response) as { resource?: LearningResource; articles?: number; error?: string };
    if (!response.ok || !result.resource) { setNotice(result.error ?? "月旦法學教室分析失敗"); return; }
    setResources((current) => current.some((item) => item.id === result.resource!.id) ? current : [result.resource!, ...current]);
    setNotice(`已建立 ${result.resource.title}，擷取 ${result.articles ?? 0} 筆試讀／文章資料，預設為草稿等待確認。`);
  }

  async function bindBookDocument(resource: LearningResource, documentId: string) {
    const response = await fetch("/api/resources", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...resource, documentId: documentId || null }) });
    const result = await readJson(response) as { resource?: LearningResource; error?: string };
    if (!response.ok || !result.resource) { setNotice(result.error ?? "教材綁定失敗"); return; }
    setResources((current) => current.map((item) => item.id === resource.id ? { ...item, documentId: result.resource!.documentId } : item));
    setNotice(`${resource.title} 已${documentId ? "綁定教材 PDF" : "解除教材綁定"}。`);
  }

  async function addExamSource(event: FormEvent) {
    event.preventDefault();
    const response = await fetch("/api/exam-sources", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url: sourceUrl, label: sourceLabel, examType: sourceExamType, sourceKind }) });
    const result = await readJson(response) as { source?: ExamSource; error?: string };
    if (!response.ok || !result.source) { setNotice(result.error ?? "無法儲存真題來源"); return; }
    setExamSources((current) => [result.source!, ...current]); setSourceUrl(""); setSourceLabel(""); setNotice("真題來源已加入等待清單；下載、拆題及人工確認功能會依來源規則接續處理。");
  }

  async function runExamSourceStep(sourceId: number) {
    setExamSources((current) => current.map((source) => source.id === sourceId ? { ...source, status: "extracting", lastError: null } : source));
    const response = await fetch("/api/exam-sources/process", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sourceId }) });
    const result = await readJson(response) as ExamProcessResult;
    if (!response.ok) throw new Error(result.error ?? "真題處理失敗");
    setExamSources((current) => current.map((source) => source.id === sourceId ? { ...source, status: result.status ?? "waiting", processedCount: result.processedCount ?? source.processedCount, discoveredCount: result.discoveredCount ?? source.discoveredCount, questionCount: result.questionCount ?? source.questionCount, lastError: null } : source));
    return result;
  }

  async function processExamSource(sourceId: number) {
    setProcessingSourceId(sourceId); setNotice("正在讀取來源、下載下一份 PDF 並拆解題目；請勿關閉頁面…");
    try { const result = await runExamSourceStep(sourceId); setNotice(`${result.message ?? "真題處理完成"}。若仍有待處理 PDF，可再次按「處理下一份」。`); }
    catch (error) { const message = error instanceof Error ? error.message : "真題處理失敗"; setExamSources((current) => current.map((source) => source.id === sourceId ? { ...source, status: "failed", lastError: message } : source)); setNotice(message); }
    finally { setProcessingSourceId(null); }
  }

  async function processAllExamSource(sourceId: number) {
    batchStopRef.current = false; setBatchSourceId(sourceId); setProcessingSourceId(sourceId); setNotice("批次處理已開始，會逐份下載與拆題；請保持此頁開啟。完成目前這份後可安全停止。");
    try {
      while (!batchStopRef.current) {
        const result = await runExamSourceStep(sourceId);
        const processed = result.processedCount ?? 0; const discovered = result.discoveredCount ?? 0;
        setNotice(`${result.message ?? "已完成一份"}；總進度 ${processed} / ${discovered} 份，累計 ${result.questionCount ?? 0} 題。`);
        if (result.status === "review" || (discovered > 0 && processed >= discovered)) break;
        await new Promise((resolve) => window.setTimeout(resolve, 600));
      }
      if (batchStopRef.current) setNotice("批次處理已停止；目前進度已保存，下次可從未完成的 PDF 繼續。");
      else setNotice("此來源的全部 PDF 已完成拆題，題目已進入待人工確認。");
    } catch (error) {
      const message = error instanceof Error ? error.message : "批次處理失敗"; setExamSources((current) => current.map((source) => source.id === sourceId ? { ...source, status: "failed", lastError: message } : source)); setNotice(`${message}；進度已保存，可按重試繼續。`);
    } finally { setBatchSourceId(null); setProcessingSourceId(null); batchStopRef.current = false; }
  }

  async function toggleFrontendCosts() {
    if (!usage) return;
    const next = !usage.showCosts;
    const response = await fetch("/api/usage", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ showCosts: next }),
    });
    if (response.ok) setUsage({ ...usage, showCosts: next });
  }

  async function startIndex(documentId: number) {
    setFiles((current) => current.map((item) => item.id === documentId ? { ...item, status: "uploading_to_index", error: null } : item));
    setNotice("正在把 PDF 送入教材索引服務…");
    try {
      const response = await fetch("/api/documents/index", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ documentId }),
      });
      const result = await readJson(response) as { status?: string; error?: string };
      if (!response.ok) throw new Error(result.error ?? "建立索引失敗");
      setFiles((current) => current.map((item) => item.id === documentId ? { ...item, status: result.status ?? "in_progress" } : item));
      setNotice("索引服務已接收文件，完成後會自動改為「可供搜尋」。");
    } catch (error) {
      const message = error instanceof Error ? error.message : "建立索引失敗";
      setFiles((current) => current.map((item) => item.id === documentId ? { ...item, status: "failed", error: message } : item));
      setNotice(message);
    }
  }

  function chooseFiles(list: FileList | File[] | null) {
    const incoming = Array.from(list ?? []);
    const pdfs = incoming.filter((file) => file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf"));
    const rejected = incoming.length - pdfs.length;
    setQueue((current) => {
      const known = new Set(current.map((item) => `${item.file.name}-${item.file.size}-${item.file.lastModified}`));
      const additions = pdfs.filter((file) => !known.has(`${file.name}-${file.size}-${file.lastModified}`)).map((file, index) => ({ key: `${file.name}-${file.size}-${file.lastModified}-${Date.now()}-${index}`, file, status: "queued" as const, progress: 0 }));
      return [...current, ...additions];
    });
    setNotice(pdfs.length ? `已加入 ${pdfs.length} 份 PDF${rejected ? `，另排除 ${rejected} 個非 PDF 檔案` : ""}。確認科目與類型後即可依序上傳。` : "拖入的檔案沒有 PDF，請重新選擇。");
  }

  function patchQueue(key: string, patch: Partial<QueueItem>) {
    setQueue((current) => current.map((item) => item.key === key ? { ...item, ...patch } : item));
  }

  async function uploadOne(item: QueueItem, position: number, total: number) {
    const selected = item.file;
    patchQueue(item.key, { status: "uploading", progress: 0, error: undefined });
    setNotice(`正在處理第 ${position}／${total} 本：${selected.name}`);

    const initResponse = await fetch("/api/documents/multipart", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "init", fileName: selected.name, contentType: "application/pdf" }),
    });
    const init = await readJson(initResponse) as { key?: string; uploadId?: string; error?: string };
    if (!initResponse.ok || !init.key || !init.uploadId) throw new Error(init.error ?? "無法開始上傳");

    const chunkSize = 5 * 1024 * 1024;
    const totalParts = Math.ceil(selected.size / chunkSize);
    const parts: Array<{ partNumber: number; etag: string }> = [];
    for (let start = 0, partNumber = 1; start < selected.size; start += chunkSize, partNumber += 1) {
      const chunk = selected.slice(start, Math.min(start + chunkSize, selected.size));
      const partResponse = await fetch(`/api/documents/multipart?key=${encodeURIComponent(init.key)}&uploadId=${encodeURIComponent(init.uploadId)}&partNumber=${partNumber}`, {
        method: "PUT",
        headers: { "content-type": "application/octet-stream" },
        body: chunk,
      });
      const part = await readJson(partResponse) as { partNumber?: number; etag?: string; error?: string };
      if (!partResponse.ok || !part.partNumber || !part.etag) throw new Error(part.error ?? `第 ${partNumber} 段上傳失敗`);
      parts.push({ partNumber: part.partNumber, etag: part.etag });
      patchQueue(item.key, { progress: Math.round(partNumber / totalParts * 85) });
    }

    const completeResponse = await fetch("/api/documents/multipart", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "complete", key: init.key, uploadId: init.uploadId, parts, fileName: selected.name, contentType: "application/pdf", sizeBytes: selected.size, subject, documentType: type }),
    });
    const completed = await readJson(completeResponse) as { document?: { id: number }; error?: string };
    if (!completeResponse.ok || !completed.document?.id) throw new Error(completed.error ?? "無法完成文件上傳");
    const newId = completed.document.id;
    setFiles((current) => [{ id: newId, name: selected.name, subject, size: `${(selected.size / 1024 / 1024).toFixed(1)} MB · ${type}`, status: "uploaded" }, ...current]);
    setDocumentPage(1);
    patchQueue(item.key, { status: "indexing", progress: 92 });

    const indexResponse = await fetch("/api/documents/index", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ documentId: newId }) });
    const indexed = await readJson(indexResponse) as { status?: string; error?: string };
    if (!indexResponse.ok) throw new Error(indexed.error ?? "建立索引失敗");
    setFiles((current) => current.map((file) => file.id === newId ? { ...file, status: indexed.status ?? "in_progress" } : file));
    patchQueue(item.key, { status: "done", progress: 100 });
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const pending = queue.filter((item) => item.status === "queued" || item.status === "failed");
    if (!pending.length) return;
    setUploading(true);
    setNotice("");
    let failed = 0;
    for (let index = 0; index < pending.length; index += 1) {
      const item = pending[index];
      try { await uploadOne(item, index + 1, pending.length); }
      catch (error) { failed += 1; patchQueue(item.key, { status: "failed", error: error instanceof Error ? error.message : "文件上傳失敗" }); }
    }
    setUploading(false);
    if (fileRef.current) fileRef.current.value = "";
    setNotice(failed ? `批次處理完成：${pending.length - failed} 本成功，${failed} 本失敗，可按下方按鈕重試失敗項目。` : `${pending.length} 本 PDF 已依序上傳，索引服務正在處理。`);
  }

  const documentPageCount = Math.max(1, Math.ceil(files.length / DOCUMENTS_PER_PAGE));
  const visibleFiles = files.slice((documentPage - 1) * DOCUMENTS_PER_PAGE, documentPage * DOCUMENTS_PER_PAGE);
  const usagePageCount = Math.max(1, Math.ceil((usage?.recent.length ?? 0) / USAGE_PER_PAGE));
  const visibleUsage = usage?.recent.slice((usagePage - 1) * USAGE_PER_PAGE, usagePage * USAGE_PER_PAGE) ?? [];

  return (
    <main className="admin-shell">
      <header className="topbar">
        <Link href="/" className="brand"><span className="brand-mark">律</span><span>司律導師</span></Link>
        <Link href="/" className="back-link">返回對話首頁 →</Link>
      </header>
      <div className="admin-main">
        <div className="admin-title">
          <div><p>MANAGEMENT WORKSPACE</p><h1>司律導師管理後台</h1></div>
        </div>
        <nav className="admin-tabs" aria-label="後台功能切換">
          <button className={activeTab === "documents" ? "active" : ""} onClick={() => setActiveTab("documents")}>教材知識庫</button>
          <button className={activeTab === "resources" ? "active" : ""} onClick={() => setActiveTab("resources")}>書籍管理</button>
          <button className={activeTab === "courses" ? "active" : ""} onClick={() => setActiveTab("courses")}>影音／試聽課</button>
          <button className={activeTab === "magazine" ? "active" : ""} onClick={() => setActiveTab("magazine")}>月旦法學教室</button>
          <button className={activeTab === "sources" ? "active" : ""} onClick={() => setActiveTab("sources")}>真題與外部來源</button>
          <button className={activeTab === "costs" ? "active" : ""} onClick={() => setActiveTab("costs")}>模型與成本</button>
        </nav>
        {activeTab === "costs" && <section className="cost-panel panel">
          <div className="cost-heading">
            <div><h2>AI 使用成本</h2><p className="panel-sub">依實際 API usage 記錄，供未來方案與收費評估。</p></div>
            <label className="cost-toggle"><input type="checkbox" checked={usage?.showCosts ?? false} onChange={toggleFrontendCosts} /><span />前台顯示成本</label>
          </div>
          <div className="cost-metrics">
            <div><span>累計對話</span><strong>{Number(usage?.totals.requests ?? 0).toLocaleString()}</strong></div>
            <div><span>輸入 Token</span><strong>{Number(usage?.totals.inputTokens ?? 0).toLocaleString()}</strong></div>
            <div><span>輸出 Token</span><strong>{Number(usage?.totals.outputTokens ?? 0).toLocaleString()}</strong></div>
            <div><span>快取 Token</span><strong>{Number(usage?.totals.cachedTokens ?? 0).toLocaleString()}</strong></div>
            <div><span>教材搜尋</span><strong>{Number(usage?.totals.fileSearchCalls ?? 0).toLocaleString()}</strong></div>
            <div className="cost-total"><span>估算總成本</span><strong>US$ {(Number(usage?.totals.costMicros ?? 0) / 1_000_000).toFixed(4)}</strong></div>
          </div>
          {usage?.recent?.length ? <><div className="usage-table-wrap"><table className="usage-table"><thead><tr><th>時間</th><th>模型</th><th>依據</th><th>輸入</th><th>快取</th><th>輸出</th><th>搜尋</th><th>成本</th></tr></thead><tbody>{visibleUsage.map((row) => <tr key={row.id}><td>{new Date(row.createdAt).toLocaleString("zh-TW", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</td><td>{row.model.replace("gpt-5.6-", "")}</td><td>{row.source}</td><td>{row.inputTokens.toLocaleString()}</td><td>{row.cachedTokens.toLocaleString()}</td><td>{row.outputTokens.toLocaleString()}</td><td>{row.fileSearchCalls}</td><td>US$ {(row.estimatedCostUsdMicros / 1_000_000).toFixed(5)}</td></tr>)}</tbody></table></div>{(usage?.recent.length ?? 0) > USAGE_PER_PAGE && <nav className="document-pagination usage-pagination" aria-label="AI 成本明細分頁"><button type="button" disabled={usagePage === 1} onClick={() => setUsagePage((page) => Math.max(1, page - 1))}>上一頁</button><span>第 {usagePage} / {usagePageCount} 頁 · 每頁 10 筆</span><button type="button" disabled={usagePage === usagePageCount} onClick={() => setUsagePage((page) => Math.min(usagePageCount, page + 1))}>下一頁</button></nav>}</> : <p className="usage-empty">新版本發布後產生的 AI 對話，會開始記錄在這裡。</p>}
        </section>}
        {activeTab === "documents" && <div className="admin-grid">
          <form className="panel" onSubmit={submit}>
            <h2>上傳教材</h2>
            <p className="panel-sub">PDF 將自動解析、切分並建立搜尋索引，供司律導師回答與教學。</p>
            <label className={`upload-zone ${dragActive ? "drag-active" : ""}`} onDragEnter={(event) => { event.preventDefault(); if (!uploading) setDragActive(true); }} onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "copy"; if (!uploading) setDragActive(true); }} onDragLeave={(event) => { event.preventDefault(); if (event.currentTarget === event.target) setDragActive(false); }} onDrop={(event) => { event.preventDefault(); setDragActive(false); if (!uploading) chooseFiles(Array.from(event.dataTransfer.files)); }}>
              <input ref={fileRef} type="file" accept="application/pdf" multiple hidden onChange={(e) => chooseFiles(e.target.files)} />
              <span className="upload-icon">＋</span>
              <strong>{dragActive ? "放開滑鼠，加入批次佇列" : queue.length ? `已選擇 ${queue.length} 份 PDF` : "拖曳大量 PDF 到這裡"}</strong>
              <span>{queue.length ? `共 ${(queue.reduce((sum, item) => sum + item.file.size, 0) / 1024 / 1024).toFixed(1)} MB · 還可以繼續拖入更多檔案` : "或點此批次選取；系統將逐本上傳與建立索引"}</span>
            </label>
            {queue.length > 0 && <div className="upload-queue">{queue.map((item, index) => <div className="queue-row" key={item.key}><div className="queue-index">{index + 1}</div><div className="queue-main"><div><strong>{item.file.name}</strong><span>{item.status === "queued" ? "等待上傳" : item.status === "uploading" ? `上傳中 ${item.progress}%` : item.status === "indexing" ? "送入索引中" : item.status === "done" ? "已送出索引" : `失敗 · ${item.error ?? "請重試"}`}</span></div><div className="queue-progress"><i style={{ width: `${item.progress}%` }} /></div></div></div>)}</div>}
            <div className="meta-fields">
              <label className="field">科目<select value={subject} onChange={(e) => setSubject(e.target.value)}><option>刑法</option><option>刑事訴訟法</option><option>民法</option><option>民事訴訟法</option><option>憲法</option><option>行政法</option><option>商事法</option></select></label>
              <label className="field">文件類型<select value={type} onChange={(e) => setType(e.target.value)}><option>教科書</option><option>解題書</option><option>講義</option><option>歷屆試題</option><option>老師擬答</option></select></label>
            </div>
            <button className="primary-btn" type="submit" disabled={!queue.some((item) => item.status === "queued" || item.status === "failed") || uploading}>{uploading ? "批次處理中，請勿關閉頁面…" : queue.some((item) => item.status === "failed") ? "重試失敗項目" : `依序上傳 ${queue.length || ""} 份並建立索引`}</button>
            {notice && <div className="notice">{notice}</div>}
          </form>
          <section className="panel document-panel">
            <h2>文件處理狀態</h2>
            <p className="panel-sub">只有完成索引的內容，才會進入教材優先檢索。</p>
            {files.length === 0 ? <div className="empty-state">尚未上傳教材<br />第一份 PDF 會顯示在這裡</div> : (
              <div className="file-list">{visibleFiles.map((file) => {
                const ready = file.status === "completed";
                const failed = file.status === "failed";
                const waiting = file.status === "uploaded";
                return <div className="file-card" key={file.id}><span className="file-type">PDF</span><div className="file-info"><strong>{file.name}</strong><span>{file.subject} · {file.size}{file.error ? ` · ${file.error}` : ""}</span></div>{waiting || failed ? <button className="index-btn" onClick={() => startIndex(file.id)}>{failed ? "重新索引" : "開始索引"}</button> : <span className={`status ${ready ? "" : "pending"}`}>{ready ? "可供搜尋" : "建立索引中"}</span>}</div>;
              })}</div>
            )}
            <div className="index-metrics" aria-label="教材索引即時統計">
              <div><span>可搜尋</span><strong>{documentStats.ready} / {documentStats.total}</strong></div>
              <div><span>索引容量</span><strong>{(documentStats.indexedBytes / 1024 / 1024).toFixed(1)} MB</strong></div>
              <div><span>教材引用</span><strong>{documentStats.citations}</strong></div>
              <div><span>未命中問題</span><strong>{documentStats.misses}</strong></div>
              <div className="index-version"><span>索引版本</span><strong>{documentStats.indexVersion}</strong></div>
            </div>
            {files.length > DOCUMENTS_PER_PAGE && <nav className="document-pagination" aria-label="文件清單分頁">
              <button type="button" disabled={documentPage === 1} onClick={() => setDocumentPage((page) => Math.max(1, page - 1))}>上一頁</button>
              <span>第 {documentPage} / {documentPageCount} 頁</span>
              <button type="button" disabled={documentPage === documentPageCount} onClick={() => setDocumentPage((page) => Math.min(documentPageCount, page + 1))}>下一頁</button>
            </nav>}
          </section>
        </div>}
        {(activeTab === "resources" || activeTab === "courses") && <section className="panel resource-manager">
          <div className="cost-heading"><div><h2>書籍與課程管理</h2><p className="panel-sub">書籍綁定教材 PDF 並管理書封；課程綁定網址與 SRT 字幕，字幕會自動拆成可搜尋的時間片段。</p></div><span className="source-count">{resources.length} 項資源</span></div>
          <form className="resource-form" onSubmit={addResource}>
            <label className="field">資源類型<select value={activeTab === "courses" ? "course" : "book"} onChange={(e) => setResourceType(e.target.value)} disabled><option value="book">書籍</option><option value="course">影音課程</option></select></label>
            <label className="field">名稱<input value={resourceTitle} onChange={(e) => setResourceTitle(e.target.value)} placeholder="例如：透明的刑法－總則編" /></label>
            <label className="field">作者／老師<input value={resourceCreator} onChange={(e) => setResourceCreator(e.target.value)} placeholder="張鏡榮律師" /></label>
            {activeTab === "courses" ? <label className="field">課程／來源網址<input type="url" value={resourceUrl} onChange={(e) => setResourceUrl(e.target.value)} placeholder="https://…" /></label> : <div className="field resource-create-hint"><span>教材 PDF</span><strong>建立後在書卡上選擇</strong></div>}
            <button className="primary-btn" disabled={!resourceTitle.trim()}>建立資源</button>
          </form>
          {notice && <div className="notice">{notice}</div>}
          <div className="resource-grid">{resources.filter((resource) => activeTab === "courses" ? resource.resourceType === "course" : resource.resourceType === "book").map((resource) => <article className="resource-card" key={resource.id}>
            <div className="resource-cover">{resource.hasCover ? <img src={`/api/resources/cover?id=${resource.id}`} alt={`${resource.title}書封`} /> : <span>{resource.resourceType === "course" ? "課" : resource.resourceType === "magazine" ? "刊" : "書"}</span>}</div>
            <div className="resource-info"><span>{resource.resourceType === "course" ? "影音課程" : resource.resourceType === "magazine" ? "期刊" : "書籍"} · {resource.subject}</span><h3>{resource.title}</h3><p>{resource.creator || "尚未設定作者／老師"}</p><small>{resource.documentId ? "已綁定教材 PDF" : resource.sourceUrl ? "已設定來源網址" : "尚未綁定內容"} · {resource.segmentCount} 個學習片段</small></div>
            <div className="resource-actions">{resource.resourceType === "book" && <select aria-label={`${resource.title}綁定教材 PDF`} value={resource.documentId ?? ""} onChange={(e) => bindBookDocument(resource, e.target.value)}><option value="">選擇教材 PDF</option>{files.map((file) => <option key={file.id} value={file.id}>{file.name}</option>)}</select>}<label>上傳書封<input type="file" accept="image/*" hidden onChange={(e) => uploadResourceAsset(resource.id, "cover", e.target.files?.[0])} /></label>{resource.resourceType === "course" && <label>上傳 SRT<input type="file" accept=".srt" hidden onChange={(e) => uploadResourceAsset(resource.id, "subtitle", e.target.files?.[0])} /></label>}</div>
          </article>)}</div>
        </section>}
        {activeTab === "magazine" && <section className="panel resource-manager"><div className="cost-heading"><div><h2>月旦法學教室</h2><p className="panel-sub">貼入歷期或單期網址後，分析期別、出刊日、試讀文章、作者與可用連結；資料先進草稿，確認後再供前台推薦。</p></div><span className="source-count">{resources.filter((item) => item.resourceType === "magazine").length} 期</span></div><div className="magazine-import"><label className="field">月旦法學教室網址<input type="url" value={magazineUrl} onChange={(e) => setMagazineUrl(e.target.value)} /></label><button type="button" className="primary-btn" onClick={analyzeMagazine}>分析並建立最新一期</button></div>{notice && <div className="notice">{notice}</div>}<div className="resource-grid">{resources.filter((item) => item.resourceType === "magazine").map((resource) => <article className="resource-card" key={resource.id}><div className="resource-cover"><span>刊</span></div><div className="resource-info"><span>{resource.status === "draft" ? "待確認" : "前台顯示"}</span><h3>{resource.title}</h3><p>{resource.creator}</p><small>{resource.description || "尚未取得出刊資料"} · {resource.segmentCount} 篇內容</small></div><div className="resource-actions"><a href={resource.sourceUrl} target="_blank" rel="noreferrer">檢視來源</a></div></article>)}</div></section>}
        {activeTab === "sources" && <section className="panel exam-source-panel"><div className="cost-heading"><div><h2>真題、法條與參考來源網址</h2><p className="panel-sub">真題拆成題目；法條建立法規名稱與條號索引；一般網站切成可引用段落。所有來源都要人工確認後才發布。</p></div><span className="source-count">{examSources.length} 個來源</span></div><form className="source-form source-form-wide" onSubmit={addExamSource}><label className="field">來源類型<select value={sourceKind} onChange={(event) => setSourceKind(event.target.value)}><option value="exam">歷屆真題</option><option value="regulation">法條資料庫</option><option value="reference">參考網站</option></select></label><label className="field">來源名稱<input value={sourceLabel} onChange={(event) => setSourceLabel(event.target.value)} placeholder={sourceKind === "regulation" ? "例如：全國法規資料庫" : "來源名稱"} /></label>{sourceKind === "exam" && <label className="field">題型<select value={sourceExamType} onChange={(event) => setSourceExamType(event.target.value)}><option value="mcq">一試選擇題</option><option value="essay">二試申論題</option></select></label>}<label className="field source-url">網址<input type="url" value={sourceUrl} onChange={(event) => setSourceUrl(event.target.value)} placeholder="https://…" /></label><button className="primary-btn" type="submit" disabled={!sourceLabel.trim() || !sourceUrl.trim()}>加入資料處理清單</button></form>{examSources.length ? <div className="source-list">{examSources.map((source) => { const statusLabel = source.status === "waiting" ? "等待處理" : source.status === "discovering" ? "搜尋 PDF 中" : source.status === "extracting" ? "AI 拆題中" : source.status === "review" ? "待人工確認" : source.status === "failed" ? "處理失敗" : source.status; return <div key={source.id}><span>{source.sourceKind === "regulation" ? "法條" : source.sourceKind === "reference" ? "參考" : source.examType === "mcq" ? "一試" : "二試"}</span><div><strong>{source.label}</strong><small>{source.url}</small>{source.sourceKind === "exam" && <small className="source-progress">已處理 {source.processedCount ?? 0} / {source.discoveredCount ?? 0} 份 PDF · 拆出 {source.questionCount ?? 0} 題{source.lastError ? ` · ${source.lastError}` : ""}</small>}</div><em>{statusLabel}</em>{source.sourceKind === "exam" && <div className="source-actions">{batchSourceId === source.id ? <button className="source-stop" type="button" onClick={() => { batchStopRef.current = true; setNotice("收到停止指令；完成目前這份 PDF 後停止。"); }}>停止批次</button> : <><button className="source-process" type="button" disabled={processingSourceId !== null || source.status === "review"} onClick={() => processExamSource(source.id)}>{processingSourceId === source.id ? "處理中…" : source.status === "failed" ? "重試" : source.status === "review" ? "已完成" : source.discoveredCount ? "處理下一份" : "立即處理"}</button><button className="source-batch" type="button" disabled={processingSourceId !== null || source.status === "review"} onClick={() => processAllExamSource(source.id)}>批次全部</button></>}</div>}</div>; })}</div> : <p className="usage-empty">尚未加入來源網址。</p>}</section>}
      </div>
    </main>
  );
}
