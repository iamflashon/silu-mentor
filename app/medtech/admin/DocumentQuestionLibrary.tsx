"use client";
import { useEffect, useMemo, useState } from "react";
import "./document-question-library.css";
import "./document-library-controls.css";
type Category = "medtech" | "accounting";
type Doc = {
  id: number;
  name: string;
  bookTitle?: string;
  subject: string;
  type: string;
  sizeBytes: number;
  status: string;
  processingStage: string;
  processingMessage: string;
  questionCount: number;
  draftQuestionCount?: number;
  pageCount?: number | null;
  error?: string | null;
  documentVersion?: {
    role?: "candidate" | "active" | "archived";
    state?: "processing" | "compared" | "active";
    baseDocumentId?: number;
    replacedByDocumentId?: number;
    comparison?: {
      identical?: number;
      changed?: number;
      added?: number;
      baseOnly?: number;
    };
  } | null;
};
const stage = (doc: Doc) =>
  doc.processingStage === "completed"
    ? "可進入工作區"
    : doc.status === "failed"
      ? "處理失敗"
      : "文件處理中";
const progress = (doc: Doc) =>
  doc.processingStage === "completed"
    ? 100
    : doc.status === "failed"
      ? 100
      : ((
          {
            queued: 8,
            uploaded: 15,
            extracting: 32,
            indexing: 64,
            analyzing: 84,
          } as Record<string, number>
        )[doc.processingStage] ?? 8);
export default function DocumentQuestionLibrary({
  category = "medtech",
  restricted = false,
}: {
  category?: Category;
  restricted?: boolean;
}) {
  const accounting = category === "accounting",
    label = accounting ? "中會" : "醫檢",
    base = accounting ? "/accounting" : "/medtech",
    api = accounting ? "/api/accounting" : "/api/medtech";
  const [docs, setDocs] = useState<Doc[]>([]),
    [loading, setLoading] = useState(true),
    [notice, setNotice] = useState(""),
    [busyId, setBusyId] = useState(0),
    [publishingId, setPublishingId] = useState(0),
    [query, setQuery] = useState(""),
    [page, setPage] = useState(1),
    [pageSize, setPageSize] = useState(10),
    [selected, setSelected] = useState<Set<number>>(new Set()),
    [batchBusy, setBatchBusy] = useState(false);
  async function load() {
    const response = await fetch(api + "/documents?limit=500", {
        cache: "no-store",
      }),
      data = (await response.json()) as { documents?: Doc[] };
    const rows = data.documents ?? [];
    setDocs(rows);
    setSelected(
      (old) =>
        new Set([...old].filter((id) => rows.some((row) => row.id === id))),
    );
    setLoading(false);
  }
  useEffect(() => {
    const initial = window.setTimeout(() => void load(), 0),
      timer = window.setInterval(() => void load(), 4000);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(timer);
    };
  }, []);
  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("zh-TW");
    return needle
      ? docs.filter((doc) =>
          [doc.name, doc.bookTitle, doc.subject, doc.type].some((value) =>
            String(value ?? "")
              .toLocaleLowerCase("zh-TW")
              .includes(needle),
          ),
        )
      : docs;
  }, [docs, query]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize)),
    safePage = Math.min(page, totalPages),
    visible = filtered.slice((safePage - 1) * pageSize, safePage * pageSize),
    visibleIds = visible.map((doc) => doc.id),
    allPageSelected =
      visibleIds.length > 0 && visibleIds.every((id) => selected.has(id)),
    allFilteredSelected =
      filtered.length > 0 && filtered.every((doc) => selected.has(doc.id));
  function changeQuery(value: string) {
    setQuery(value);
    setPage(1);
  }
  function toggle(id: number) {
    setSelected((old) => {
      const next = new Set(old);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }
  function selectPage() {
    setSelected((old) => {
      const next = new Set(old);
      if (allPageSelected) visibleIds.forEach((id) => next.delete(id));
      else visibleIds.forEach((id) => next.add(id));
      return next;
    });
  }
  function selectAllResults() {
    setSelected((old) => {
      const next = new Set(old);
      if (allFilteredSelected) filtered.forEach((doc) => next.delete(doc.id));
      else filtered.forEach((doc) => next.add(doc.id));
      return next;
    });
  }
  function open(doc: Doc) {
    if (doc.processingStage === "completed")
      window.location.assign(
        base +
          "/admin/document-workspace?id=" +
          doc.id +
          "&autoImport=" +
          (doc.documentVersion?.role === "candidate" &&
          doc.documentVersion.state === "processing"
            ? "1"
            : doc.questionCount
              ? "0"
              : "1") +
          (restricted ? "&quality=1" : ""),
      );
  }
  async function deleteIds(ids: number[]) {
    let deleted = 0;
    for (let start = 0; start < ids.length; start += 100) {
      const response = await fetch(api + "/documents", {
          method: "DELETE",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ids: ids.slice(start, start + 100) }),
        }),
        data = (await response.json()) as { deleted?: number; error?: string };
      if (!response.ok) throw new Error(data.error || "刪除文件失敗");
      deleted += Number(data.deleted ?? 0);
    }
    return deleted;
  }
  async function remove(doc: Doc) {
    if (
      !confirm(
        `確定刪除「${doc.name}」？該文件的原稿、索引與 ${doc.questionCount} 題配對題目都會移除。`,
      )
    )
      return;
    setBusyId(doc.id);
    try {
      await deleteIds([doc.id]);
      setDocs((list) => list.filter((item) => item.id !== doc.id));
      setSelected((old) => {
        const next = new Set(old);
        next.delete(doc.id);
        return next;
      });
      setNotice(`已刪除「${doc.name}」及其配對題目。`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "刪除文件失敗");
    } finally {
      setBusyId(0);
    }
  }
  async function removeSelected() {
    const ids = [...selected].filter((id) => docs.some((doc) => doc.id === id));
    if (!ids.length) return;
    const questions = docs
      .filter((doc) => ids.includes(doc.id))
      .reduce((sum, doc) => sum + doc.questionCount, 0);
    if (
      !confirm(
        `確定批次刪除已選取的 ${ids.length} 本文件？\n\n原稿、索引及約 ${questions.toLocaleString()} 題配對題目都會一併刪除，無法復原。`,
      )
    )
      return;
    setBatchBusy(true);
    setNotice(`正在刪除 ${ids.length} 本文件及相關資料…`);
    try {
      const deleted = await deleteIds(ids);
      setDocs((list) => list.filter((doc) => !ids.includes(doc.id)));
      setSelected(new Set());
      setNotice(
        `批次刪除完成：已移除 ${deleted} 本文件、原稿、索引及配對題目。`,
      );
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "批次刪除失敗，未完成部分仍保留",
      );
    } finally {
      setBatchBusy(false);
      await load();
    }
  }
  async function replace(doc: Doc, file: File) {
    if (
      !confirm(
        `確定新增「${file.name}」作為「${doc.name}」的另一個原稿版本？現有題目、解析與順序會保留，不會重新拆題。`,
      )
    )
      return;
    setBusyId(doc.id);
    setNotice("正在新增原稿版本，現有題目不會重新拆解…");
    const form = new FormData();
    form.set("id", String(doc.id));
    form.set("file", file);
    const response = await fetch(api + "/documents", {
        method: "PUT",
        body: form,
      }),
      data = (await response.json()) as { error?: string };
    if (response.ok) {
      setNotice(`已新增「${file.name}」原稿版本，既有題目已保留。`);
      await load();
    } else setNotice(data.error || "新增原稿失敗");
    setBusyId(0);
  }
  async function uploadVersion(doc: Doc, file: File) {
    if (
      !confirm(
        `確定將「${file.name}」建立為「${doc.bookTitle || doc.name}」的舊版候選文件？\n\n系統會獨立保存並重新拆題，不會覆蓋目前版本。`,
      )
    )
      return;
    setBusyId(doc.id);
    setNotice("正在建立舊版候選文件，現有版本不會被覆蓋…");
    try {
      const form = new FormData();
      form.set("file", file);
      form.set("subject", doc.subject);
      form.set("bookTitle", `${doc.bookTitle || doc.name}（舊版候選）`);
      form.set("documentType", doc.type || "題庫");
      form.set("baseDocumentId", String(doc.id));
      const response = await fetch(api + "/documents", {
        method: "POST",
        body: form,
      });
      const data = (await response.json()) as {
        document?: { id?: number };
        error?: string;
      };
      if (!response.ok || !data.document?.id)
        throw new Error(data.error || "舊版文件上傳失敗");
      await fetch(api + "/documents/process", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ documentId: data.document.id }),
      });
      setNotice(
        "舊版已建立為獨立候選文件；處理完成後請進入工作區拆題，再回來執行版本比對。",
      );
      await load();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "舊版文件上傳失敗");
    } finally {
      setBusyId(0);
    }
  }
  async function compareVersion(doc: Doc) {
    if (!doc.documentVersion?.baseDocumentId) return;
    setBusyId(doc.id);
    setNotice("正在比對新舊題目並沿用相同題目的校對成果…");
    try {
      const response = await fetch(api + "/documents", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: doc.id,
          action: "compareVersion",
          baseDocumentId: doc.documentVersion.baseDocumentId,
        }),
      });
      const data = (await response.json()) as {
        comparison?: {
          identical?: number;
          changed?: number;
          added?: number;
          baseOnly?: number;
        };
        error?: string;
      };
      if (!response.ok) throw new Error(data.error || "版本比對失敗");
      const result = data.comparison ?? {};
      setNotice(
        `版本比對完成：相同 ${result.identical ?? 0} 題已沿用校對成果；差異 ${result.changed ?? 0} 題、舊版新增 ${result.added ?? 0} 題已標記待人工確認；新版獨有 ${result.baseOnly ?? 0} 題。`,
      );
      await load();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "版本比對失敗");
    } finally {
      setBusyId(0);
    }
  }
  async function activateVersion(doc: Doc) {
    if (
      !confirm(
        `確定將「${doc.bookTitle || doc.name}」設為正式使用版本？目前版本會封存保留。`,
      )
    )
      return;
    setBusyId(doc.id);
    setNotice("正在切換正式版本…");
    try {
      const response = await fetch(api + "/documents", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: doc.id, action: "activateVersion" }),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(data.error || "正式版本切換失敗");
      setNotice("正式版本切換完成；原版本已封存保留。");
      await load();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "正式版本切換失敗");
    } finally {
      setBusyId(0);
    }
  }
  async function publishDocument(doc: Doc) {
    const count = Number(doc.draftQuestionCount ?? 0);
    if (!count) {
      setNotice(`「${doc.name}」目前沒有待發布草稿題目。`);
      return;
    }
    if (
      !confirm(
        `確定只發布「${doc.name}」的 ${count.toLocaleString()} 題草稿？其他文件不會受到影響。`,
      )
    )
      return;
    setPublishingId(doc.id);
    setNotice(`正在檢查並發布「${doc.name}」…`);
    try {
      const response = await fetch(api + "/admin/questions", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ publishAllDrafts: true, documentId: doc.id }),
        }),
        data = (await response.json()) as {
          updated?: number;
          skippedUnanswered?: number;
          error?: string;
        };
      if (!response.ok) {
        setNotice(data.error || "發布失敗，請稍後再試。");
        return;
      }
      const skipped = Number(data.skippedUnanswered ?? 0);
      setNotice(
        skipped
          ? `「${doc.name}」已發布 ${Number(data.updated ?? 0).toLocaleString()} 題；另有 ${skipped.toLocaleString()} 題沒有有效老師答案，仍保留草稿。`
          : `「${doc.name}」已發布 ${Number(data.updated ?? 0).toLocaleString()} 題。`,
      );
      await load();
    } catch {
      setNotice("發布失敗，請稍後再試。");
    } finally {
      setPublishingId(0);
    }
  }
  return (
    <>
      <section className="medtech-admin-panel file-question-heading">
        <div>
          <span>以文件為單位</span>
          <h2>{label}文件題庫</h2>
          <p>
            {restricted
              ? "只會顯示管理員授權的書本；可開啟原稿對照並編修題目。"
              : "每份原稿對應自己的題目清單；可搜尋、分頁、勾選並批次刪除。"}
          </p>
        </div>
        {!restricted && (
          <div className="file-question-heading-actions">
            <a href={base + "/admin/questions"}>題庫總覽</a>
          </div>
        )}
      </section>
      {notice && (
        <section className="medtech-admin-panel library-notice">
          {notice}
        </section>
      )}
      <section className="medtech-admin-panel">
        <div className="file-library-tools">
          <label className="file-search">
            <span>搜尋書本</span>
            <input
              value={query}
              onChange={(event) => changeQuery(event.target.value)}
              placeholder="輸入書名、檔名、科目或教材類型"
            />
            <b>{filtered.length} 本</b>
          </label>
          <label>
            每頁
            <select
              value={pageSize}
              onChange={(event) => {
                setPageSize(Number(event.target.value));
                setPage(1);
              }}
            >
              <option value="10">10 本</option>
              <option value="20">20 本</option>
              <option value="50">50 本</option>
            </select>
          </label>
          {!restricted && (
            <div className="file-batch-actions">
              <button type="button" onClick={selectPage}>
                {allPageSelected ? "取消本頁" : "本頁全選"}
              </button>
              <button type="button" onClick={selectAllResults}>
                {allFilteredSelected ? "取消搜尋結果" : "全選搜尋結果"}
              </button>
              <button
                type="button"
                className="danger"
                disabled={!selected.size || batchBusy}
                onClick={() => void removeSelected()}
              >
                {batchBusy ? "批次刪除中…" : `批次刪除（${selected.size}）`}
              </button>
            </div>
          )}
        </div>
        <div className="file-question-list">
          {loading ? (
            <p>正在讀取文件題庫…</p>
          ) : (
            visible.map((doc) => (
              <article
                key={doc.id}
                className={selected.has(doc.id) ? "selected" : ""}
              >
                {!restricted && (
                  <label className="file-select">
                    <input
                      type="checkbox"
                      checked={selected.has(doc.id)}
                      onChange={() => toggle(doc.id)}
                      aria-label={`選取 ${doc.name}`}
                    />
                  </label>
                )}
                <div className="file-icon">
                  {doc.name.toLowerCase().endsWith(".pdf")
                    ? "PDF"
                    : /\.html?$/i.test(doc.name)
                      ? "HTML"
                      : "DOC"}
                </div>
                <div className="file-info">
                  <span>
                    {doc.subject} · {doc.type}
                  </span>
                  <h3 title={doc.name}>{doc.bookTitle || doc.name}</h3>
                  {doc.bookTitle && doc.bookTitle !== doc.name && (
                    <small className="file-source-name">原稿：{doc.name}</small>
                  )}
                  <small>
                    {(doc.sizeBytes / 1048576).toFixed(2)} MB
                    {doc.pageCount ? ` · ${doc.pageCount} 頁` : ""}
                  </small>
                  {doc.documentVersion?.role && (
                    <small
                      className={`document-version-badge ${doc.documentVersion.role}`}
                    >
                      {doc.documentVersion.role === "active"
                        ? "正式版本"
                        : doc.documentVersion.role === "archived"
                          ? "已封存版本"
                          : doc.documentVersion.state === "compared"
                            ? "舊版候選・已完成比對"
                            : "舊版候選・等待拆題比對"}
                    </small>
                  )}
                  {doc.documentVersion?.comparison && (
                    <small className="document-version-summary">
                      相同 {doc.documentVersion.comparison.identical ?? 0}｜差異{" "}
                      {doc.documentVersion.comparison.changed ?? 0}｜新增{" "}
                      {doc.documentVersion.comparison.added ?? 0}｜新版獨有{" "}
                      {doc.documentVersion.comparison.baseOnly ?? 0}
                    </small>
                  )}
                </div>
                <div className={`file-stage ${doc.processingStage}`}>
                  <b>
                    {stage(doc)} · {progress(doc)}%
                  </b>
                  <span>{doc.error || doc.processingMessage}</span>
                  <i />
                </div>
                <div className="file-question-count">
                  <b>{doc.questionCount}</b>
                  <span>拆出題目</span>
                </div>
                <div className="file-actions">
                  {!restricted && (
                    <button
                      className="optimize-document"
                      disabled={
                        busyId === doc.id ||
                        publishingId === doc.id ||
                        batchBusy
                      }
                      onClick={() =>
                        window.location.assign(
                          base +
                            "/admin/document-workspace?id=" +
                            doc.id +
                            "&quality=1",
                        )
                      }
                    >
                      題庫品質修復中心
                    </button>
                  )}
                  <button
                    className="primary"
                    disabled={
                      busyId === doc.id || doc.processingStage !== "completed"
                    }
                    onClick={() => open(doc)}
                  >
                    {doc.documentVersion?.role === "candidate" &&
                    doc.documentVersion.state === "processing"
                      ? "進入工作區重新拆題"
                      : doc.questionCount
                        ? "開啟對照工作區"
                        : "進入並開始拆題"}
                  </button>
                  {!restricted && (
                    <button
                      className="publish-document"
                      disabled={
                        busyId === doc.id ||
                        publishingId === doc.id ||
                        doc.processingStage !== "completed" ||
                        !Number(doc.draftQuestionCount ?? 0)
                      }
                      onClick={() => void publishDocument(doc)}
                    >
                      {publishingId === doc.id
                        ? "發布中…"
                        : Number(doc.draftQuestionCount ?? 0)
                          ? `發布此文件（${Number(doc.draftQuestionCount).toLocaleString()} 題）`
                          : "本文件已發布"}
                    </button>
                  )}
                  {!restricted && (
                    <>
                      {!accounting &&
                        doc.documentVersion?.role !== "candidate" &&
                        doc.documentVersion?.role !== "archived" && (
                          <label className="version-upload">
                            上傳舊版並重新拆解
                            <input
                              hidden
                              type="file"
                              accept=".pdf"
                              disabled={
                                busyId === doc.id ||
                                publishingId === doc.id ||
                                batchBusy
                              }
                              onChange={(event) => {
                                const file = event.target.files?.[0];
                                event.currentTarget.value = "";
                                if (file) void uploadVersion(doc, file);
                              }}
                            />
                          </label>
                        )}
                      {!accounting &&
                        doc.documentVersion?.role === "candidate" &&
                        doc.questionCount > 0 &&
                        doc.documentVersion.state !== "compared" && (
                          <button
                            className="version-compare"
                            disabled={busyId === doc.id}
                            onClick={() => void compareVersion(doc)}
                          >
                            執行新舊題目比對
                          </button>
                        )}
                      {!accounting &&
                        doc.documentVersion?.role === "candidate" &&
                        doc.documentVersion.state === "compared" && (
                          <button
                            className="version-activate"
                            disabled={busyId === doc.id}
                            onClick={() => void activateVersion(doc)}
                          >
                            設為正式版本
                          </button>
                        )}
                      <label className="secondary">
                        新增原稿版本
                        <input
                          hidden
                          type="file"
                          accept=".pdf,.html,.htm,.docx"
                          disabled={
                            busyId === doc.id ||
                            publishingId === doc.id ||
                            batchBusy
                          }
                          onChange={(event) => {
                            const file = event.target.files?.[0];
                            event.currentTarget.value = "";
                            if (file) void replace(doc, file);
                          }}
                        />
                      </label>
                      <button
                        className="danger"
                        disabled={
                          busyId === doc.id ||
                          publishingId === doc.id ||
                          batchBusy
                        }
                        onClick={() => void remove(doc)}
                      >
                        刪除
                      </button>
                    </>
                  )}
                </div>
              </article>
            ))
          )}
          {!loading && !filtered.length && (
            <div className="file-empty">
              <b>{query ? "找不到符合的書本" : "尚無已授權書本"}</b>
              <p>
                {query
                  ? "請改用書名、檔名、科目或教材類型搜尋。"
                  : restricted
                    ? "請由總管理員在會員管理中勾選可編輯書本。"
                    : "請先到「文件上傳」新增 PDF、HTML 或 Word 原稿。"}
              </p>
            </div>
          )}
        </div>
        {filtered.length > 0 && (
          <nav className="file-pagination" aria-label="文件題庫分頁">
            <button disabled={safePage <= 1} onClick={() => setPage(1)}>
              第一頁
            </button>
            <button
              disabled={safePage <= 1}
              onClick={() => setPage((value) => Math.max(1, value - 1))}
            >
              上一頁
            </button>
            <span>
              第 {safePage}／{totalPages} 頁 · 共 {filtered.length} 本
            </span>
            <button
              disabled={safePage >= totalPages}
              onClick={() =>
                setPage((value) => Math.min(totalPages, value + 1))
              }
            >
              下一頁
            </button>
            <button
              disabled={safePage >= totalPages}
              onClick={() => setPage(totalPages)}
            >
              最後一頁
            </button>
          </nav>
        )}
      </section>
    </>
  );
}
