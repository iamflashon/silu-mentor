"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";

type LegalArticle = {
  title: string;
  articleNo: string;
  hierarchy?: string;
  content: string;
  modifiedDate?: string;
  sourceUrl?: string;
};
type JudicialDecision = {
  id: number;
  court: string;
  year: string;
  caseType: string;
  caseNo: string;
  judgmentDate: string;
  title: string;
  fullText: string;
  excerpt: string;
};
type ToolPosition = { left: number; top: number; placement: "above" | "below" };
type ExplainUsage = {
  model: string;
  inputTokens: number;
  cachedTokens: number;
  outputTokens: number;
  durationMs: number;
  estimatedCostUsd: number;
};
type MedtechExplainAccess = {
  freeRemaining: number;
  creditCost: number;
  pointsRemaining: number;
};
type LegalAnalysis = {
  kind?: string;
  officialName?: string;
  legalField?: string;
  nature?: string;
  reference?: string;
  points?: string[];
  verification?: string;
  caveat?: string;
};
type NoteDraft = {
  title: string;
  content: string;
  originalContent?: string;
  subject: string;
  tags: string;
  sourceLabel: string;
  usage?: ExplainUsage;
  reused?: boolean;
};
const LAW_ALIASES: Record<string, string> = {
  憲訴法: "憲法訴訟法",
  憲法訴訟法: "憲法訴訟法",
  民訴法: "民事訴訟法",
  刑訴法: "刑事訴訟法",
  行訴法: "行政訴訟法",
  行程法: "行政程序法",
};
const LAW_REFERENCE =
  /(?:中華民國)?(?:憲訴法|憲法訴訟法|憲法|民法|刑法|行政程序法|行程法|行政訴訟法|行訴法|民事訴訟法|民訴法|刑事訴訟法|刑訴法|公司法|證券交易法|保險法|票據法|強制執行法|破產法|著作權法|商標法|公平交易法|消費者保護法|個人資料保護法)第\d+(?:條之\d+|之\d+條|條)(?:第\d+項)?(?:第\d+款)?/u;
const JUDICIAL_REFERENCE =
  /(?<court>[\p{Script=Han}]{2,20}法院)(?:民事|刑事|行政)?(?:判決|裁定)?\s*(?<year>\d{1,3})\s*年度\s*(?<caseType>[\p{Script=Han}]{1,8})\s*字\s*第\s*(?<caseNo>\d+)\s*號/u;

function isEditable(node: Node | null) {
  const element = node instanceof Element ? node : node?.parentElement;
  return Boolean(
    element?.closest(
      "input, textarea, select, [contenteditable='true'], [role='textbox'], .monaco-editor, .cm-editor",
    ),
  );
}

function selectionRoot(node: Node | null) {
  const element = node instanceof Element ? node : node?.parentElement;
  return (
    element?.closest(
      "[data-selection-scope], .message-bubble, .daily-chat-message, .course-chat-message, .essay-chat-bubble, .practice-inline-question, .practice-question-panel, .mock-question, .student-issue-question, .student-issue-analysis, .problem-question-stem, .standalone-note-list article, .medtech-ai-question, .medtech-ai-chat, .medtech-question",
    ) ?? null
  );
}

export default function GlobalSelectionTools() {
  const pathname = usePathname();
  const isMedtech = pathname.startsWith("/medtech");
  const isAccounting = pathname.startsWith("/accounting");
  const isPengli = pathname.startsWith("/teachers/pengli");
  const [selectedText, setSelectedText] = useState("");
  const [selectionSource, setSelectionSource] = useState("");
  const [editingSelection, setEditingSelection] = useState(false);
  const [lawQuery, setLawQuery] = useState("");
  const [judicialQuery, setJudicialQuery] = useState<{
    court: string;
    year: string;
    caseType: string;
    caseNo: string;
  } | null>(null);
  const [position, setPosition] = useState<ToolPosition | null>(null);
  const [lookup, setLookup] = useState<{
    mode: "search" | "explain";
    loading: boolean;
    article: LegalArticle | null;
    decision: JudicialDecision | null;
    error: string;
    explanation: string;
    analysis: LegalAnalysis | null;
    explaining: boolean;
    usage: ExplainUsage | null;
    access?: MedtechExplainAccess;
    coachAccess?: { charged?: boolean; remaining?: number; coachRoundsUsed?: number; coachRoundsTarget?: number };
    canAiFallback?: boolean;
    aiFallback?: boolean;
    sourceStatus?: string;
  } | null>(null);
  const [noteDraft, setNoteDraft] = useState<NoteDraft | null>(null);
  const [saveState, setSaveState] = useState<"" | "saving" | "saved" | "error">(
    "",
  );
  const [saveMessage, setSaveMessage] = useState("");
  const [organizeState, setOrganizeState] = useState<
    "" | "organizing" | "error"
  >("");
  const rangeRef = useRef<Range | null>(null);
  const selectionBarRef = useRef<HTMLDivElement | null>(null);

  function applySelectedText(value: string) {
    const text = value.replace(/\s+/g, " ").trim().slice(0, 1200);
    const compactText = text.replace(/\s+/g, "");
    const match = compactText.match(LAW_REFERENCE);
    const judicial = compactText.match(JUDICIAL_REFERENCE);
    const rawLawQuery = match?.[0] ?? "";
    const normalizedLawQuery = Object.entries(LAW_ALIASES).reduce(
      (current, [alias, full]) => current.replace(alias, full),
      rawLawQuery,
    );
    setSelectedText(text);
    setLawQuery(normalizedLawQuery);
    setJudicialQuery(
      judicial?.groups
        ? {
            court: judicial.groups.court,
            year: judicial.groups.year,
            caseType: judicial.groups.caseType,
            caseNo: judicial.groups.caseNo,
          }
        : null,
    );
  }

  function place(range: Range) {
    const rect = range.getBoundingClientRect();
    if (!rect.width && !rect.height) return;
    const compact = window.innerWidth < 760;
    const halfWidth = compact
      ? Math.min(170, Math.max(120, window.innerWidth / 2 - 12))
      : Math.min(300, window.innerWidth / 2 - 12);
    const left = Math.min(
      window.innerWidth - halfWidth,
      Math.max(halfWidth, rect.left + rect.width / 2),
    );
    const above = rect.bottom + (compact ? 112 : 68) > window.innerHeight;
    setPosition({
      left,
      top: above ? Math.max(8, rect.top - 10) : rect.bottom + 10,
      placement: above ? "above" : "below",
    });
  }

  function dismiss(clearText = false) {
    setPosition(null);
    setEditingSelection(false);
    rangeRef.current = null;
    window.getSelection()?.removeAllRanges();
    if (clearText) {
      setSelectedText("");
      setLawQuery("");
      setJudicialQuery(null);
      setSelectionSource("");
    }
  }

  useEffect(() => {
    if (!position) return;
    const dismissOnOutsidePress = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && selectionBarRef.current?.contains(target))
        return;
      dismiss(true);
    };
    document.addEventListener("pointerdown", dismissOnOutsidePress, true);
    return () =>
      document.removeEventListener("pointerdown", dismissOnOutsidePress, true);
  }, [position]);

  useEffect(() => {
    const capture = () => {
      const selection = window.getSelection();
      if (
        !selection ||
        selection.isCollapsed ||
        !selection.rangeCount ||
        isEditable(selection.anchorNode) ||
        isEditable(selection.focusNode)
      )
        return;
      const anchorRoot = selectionRoot(selection.anchorNode);
      const focusRoot = selectionRoot(selection.focusNode);
      if (!anchorRoot || anchorRoot !== focusRoot) return;
      const text = selection
        .toString()
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 1200);
      if (text.length < 2) {
        setPosition(null);
        return;
      }
      const range = selection.getRangeAt(0).cloneRange();
      setSelectionSource(anchorRoot.getAttribute("data-selection-source") || "");
      rangeRef.current = range;
      applySelectedText(text);
      setEditingSelection(false);
      place(range);
    };
    document.addEventListener("mouseup", capture);
    document.addEventListener("touchend", capture);
    return () => {
      document.removeEventListener("mouseup", capture);
      document.removeEventListener("touchend", capture);
    };
  }, []);

  useEffect(() => {
    if (!position) return;
    const reposition = () => rangeRef.current && place(rangeRef.current);
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    return () => {
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
    };
  }, [position]);

  async function searchLaw() {
    if (!lawQuery) return;
    const query = lawQuery.replace(/第\d+項$/u, "");
    dismiss();
    setLookup({
      mode: "search",
      loading: true,
      article: null,
      decision: null,
      error: "",
      explanation: "",
      analysis: null,
      explaining: false,
      usage: null,
    });
    const response = await fetch(
      `/api/legal-search?q=${encodeURIComponent(query)}&limit=5`,
    );
    const data = await response.json();
    const article = (data.results?.find(
      (item: LegalArticle & { matchType?: string }) =>
        item.matchType === "exact",
    ) ??
      data.results?.[0] ??
      null) as LegalArticle | null;
    setLookup({
      mode: "search",
      loading: false,
      article,
      decision: null,
      error:
        response.ok && article
          ? ""
          : data.error || "已下載的全國法規資料庫查無這條法條。",
      explanation: "",
      analysis: null,
      explaining: false,
      usage: null,
    });
  }

  async function searchJudicial() {
    if (!judicialQuery) return;
    dismiss();
    setLookup({
      mode: "search",
      loading: true,
      article: null,
      decision: null,
      error: "",
      explanation: "",
      analysis: null,
      explaining: false,
      usage: null,
    });
    const q = `${judicialQuery.year}年度${judicialQuery.caseType}字第${judicialQuery.caseNo}號`;
    const response = await fetch(
      `/api/judicial-search?q=${encodeURIComponent(q)}&court=${encodeURIComponent(judicialQuery.court)}&year=${encodeURIComponent(judicialQuery.year)}&limit=5`,
    );
    const data = await response.json();
    const decision = (data.results?.find(
      (item: JudicialDecision) =>
        item.caseType === judicialQuery.caseType &&
        item.caseNo === judicialQuery.caseNo,
    ) ??
      data.results?.[0] ??
      null) as JudicialDecision | null;
    setLookup({
      mode: "search",
      loading: false,
      article: null,
      decision,
      error:
        response.ok && decision
          ? ""
          : data.error || "已下載的司法院裁判資料庫查無此裁判。",
      explanation: "",
      analysis: null,
      explaining: false,
      usage: null,
    });
  }

  async function openOfficialSearch(url: string) {
    const keyword = judicialQuery
      ? `${judicialQuery.court}${judicialQuery.year}年度${judicialQuery.caseType}字第${judicialQuery.caseNo}號`
      : lawQuery || selectedText;
    try {
      await navigator.clipboard.writeText(keyword);
    } catch {
      /* 仍可開啟官方網站手動貼上 */
    }
    window.open(url, "_blank", "noopener,noreferrer");
  }

  async function explain(allowAiFallback = false) {
    if (!selectedText || lookup?.explaining) return;
    dismiss();
    const current = lookup ?? {
      mode: "explain" as const,
      loading: false,
      article: null,
      decision: null,
      error: "",
      explanation: "",
      analysis: null,
      explaining: false,
      usage: null,
    };
    setLookup({
      ...current,
      mode: "explain",
      loading: !lookup,
      explaining: true,
      error: "",
    });
    const reference =
      current.article ??
      (current.decision
        ? {
            title: current.decision.court,
            articleNo: `${current.decision.year}年度${current.decision.caseType}字第${current.decision.caseNo}號`,
            content: current.decision.fullText || current.decision.excerpt,
          }
        : null);
    const response = await fetch(
      isMedtech
        ? "/api/medtech/explain"
        : isAccounting
          ? "/api/accounting/tutor"
          : isPengli ? "/api/teachers/pengli/coach" : "/api/legal-explain",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          isMedtech
            ? { selectedText }
            : isAccounting
              ? {
                  messages: [
                    {
                      role: "student",
                      text: `請只針對這段中級會計內容做簡短白話說明：\n${selectedText}`,
                    },
                  ],
                  mode: "free",
                }
              : isPengli
                ? { selectedText, mode: "plain-explain", allowAiFallback, requestKey: crypto.randomUUID() }
                : { selectedText, article: reference },
        ),
      },
    );
    const data = await response.json();
    // 彭狸白話解釋若未帶回完整額度狀態，立即同步會員目前權益，
    // 避免前台顯示「剩餘 — 次」。
    if (
      isPengli &&
      response.ok &&
      (!data.access || typeof data.access.remaining !== "number")
    ) {
      try {
        const accessResponse = await fetch("/api/ai-access", { cache: "no-store" });
        const accessData = accessResponse.ok ? await accessResponse.json() : null;
        if (accessData?.aiAccess) {
          data.access = {
            ...(data.access ?? {}),
            remaining: accessData.aiAccess.remaining,
            coachRoundsUsed: accessData.aiAccess.coachRoundsUsed,
            coachRoundsTarget: accessData.aiAccess.coachRoundsTarget,
          };
        }
      } catch {
        /* 白話解釋本身已成功時，不因額度顯示同步失敗而中斷 */
      }
    }
    const explanation =
      typeof (isAccounting ? data.reply : data.explanation) === "string"
        ? String(isAccounting ? data.reply : data.explanation).trim()
        : "";
    const looksLikeRawJson =
      explanation.startsWith("{") ||
      explanation.includes('"analysis"') ||
      explanation.includes('"explanation"');
    const valid = response.ok && explanation.length > 0 && !looksLikeRawJson;
    if (isMedtech && valid)
      window.dispatchEvent(new Event("medtech-points-updated"));
    setLookup((latest) =>
      latest
        ? {
            ...latest,
            mode: "explain",
            loading: false,
            explaining: false,
            explanation: valid ? explanation : "",
            analysis:
              valid && data.analysis && typeof data.analysis === "object"
                ? data.analysis
                : null,
            usage: valid ? (data.usage ?? null) : null,
            access:
              valid && data.access && typeof data.access === "object"
                ? (data.access as MedtechExplainAccess)
                : latest.access,
            coachAccess:
              valid && data.access && typeof data.access === "object"
                ? data.access
                : latest.coachAccess,
            error: valid ? "" : data.error || "AI 回傳格式不完整，請再試一次。",
            canAiFallback: !valid && data.canAiFallback === true,
            aiFallback: valid && data.aiFallback === true,
            sourceStatus: valid ? String(data.sourceStatus ?? "") : "",
          }
        : latest,
    );
    if (isPengli && valid) {
      await saveSelection("note", {
        title: selectedText.slice(0, 32) || "彭狸行政法學習筆記",
        content: `【核心原文】\n${selectedText}\n\n【白話重點整理】\n${explanation}\n\n【來源狀態】\n${data.sourceStatus || "彭狸老師教材"}`,
        originalContent: selectedText,
        subject: "行政法｜彭狸老師專區",
        tags: data.aiFallback ? "行政法、AI補充、白話筆記" : "行政法、彭狸老師、白話筆記",
        sourceLabel: data.aiFallback ? "AI 法律補充（未命中彭狸老師教材）" : selectionSource || "彭狸老師《行政法考點演習書（二版）》",
      });
    }
  }

  function noteFromLookup(): NoteDraft {
    if (isAccounting) {
      const parts = [selectedText];
      if (lookup?.explanation)
        parts.push(`中會白話說明\n${lookup.explanation}`);
      return {
        title: selectedText.slice(0, 32) || "中級會計學習筆記",
        content: parts.filter(Boolean).join("\n\n"),
        subject: "中級會計",
        tags: "中會、待複習",
        sourceLabel: "Luna 助教答疑",
      };
    }
    if (isMedtech) {
      const parts = [selectedText];
      if (lookup?.explanation)
        parts.push(`醫檢白話解析\n${lookup.explanation}`);
      return {
        title:
          lookup?.analysis?.officialName ||
          selectedText.slice(0, 32) ||
          "醫檢學習筆記",
        content: parts.filter(Boolean).join("\n\n"),
        subject: "醫檢師｜臨床病毒學",
        tags: "醫檢師、待複習",
        sourceLabel: "醫檢師引導學習",
      };
    }
    if (isPengli) {
      const parts = [selectedText];
      if (lookup?.explanation) parts.push(`白話解釋\n${lookup.explanation}`);
      return {
        title: selectedText.slice(0, 32) || "彭狸行政法學習筆記",
        content: parts.filter(Boolean).join("\n\n"),
        subject: "行政法｜彭狸老師專區",
        tags: "行政法、彭狸老師、待複習",
        sourceLabel: selectionSource || "彭狸老師《行政法考點演習書（二版）》",
      };
    }
    const title =
      lookup?.analysis?.officialName ||
      lookup?.article?.articleNo ||
      (lookup?.decision
        ? `${lookup.decision.year}年度${lookup.decision.caseType}字第${lookup.decision.caseNo}號`
        : selectedText.slice(0, 32)) ||
      "法律學習筆記";
    const parts = [selectedText];
    if (lookup?.article)
      parts.push(
        `${lookup.article.title} ${lookup.article.articleNo}\n${lookup.article.content}`,
      );
    if (lookup?.decision)
      parts.push(
        `${lookup.decision.court} ${lookup.decision.year}年度${lookup.decision.caseType}字第${lookup.decision.caseNo}號\n${lookup.decision.fullText || lookup.decision.excerpt}`,
      );
    if (lookup?.analysis?.points?.length)
      parts.push(
        `拆解重點\n${lookup.analysis.points.map((point) => `・${point}`).join("\n")}`,
      );
    if (lookup?.explanation) parts.push(`白話解釋\n${lookup.explanation}`);
    return {
      title,
      content: parts.filter(Boolean).join("\n\n"),
      subject: lookup?.analysis?.legalField || "綜合",
      tags: "待複習",
      sourceLabel: lookup?.article
        ? `${lookup.article.title} ${lookup.article.articleNo}`
        : lookup?.decision
          ? `${lookup.decision.court}裁判`
          : "AI 法律助教",
    };
  }

  async function saveSelection(
    kind: "favorite" | "note",
    draft = noteFromLookup(),
  ) {
    setSaveState("saving");
    setSaveMessage("");
    const original = draft.originalContent || draft.content;
    let hash = 2166136261;
    for (let index = 0; index < original.length; index++)
      hash = Math.imul(hash ^ original.charCodeAt(index), 16777619);
    const sourceId = `${isMedtech ? "medtech-selection" : isPengli ? "pengli-selection" : "selection"}-${(hash >>> 0).toString(16)}-${original.length}`;
    const response = await fetch("/api/notes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...draft,
        category: isMedtech ? "medtech" : isAccounting ? "accounting" : isPengli ? "pengli" : "law",
        sourceType: kind,
        sourceId,
      }),
    });
    if (!response.ok) {
      const data = (await response.json().catch(() => ({}))) as {
        error?: string;
      };
      setSaveMessage(
        typeof data.error === "string"
          ? data.error
          : "目前無法保存，請稍後再試。",
      );
      setSaveState("error");
      return;
    }
    setSaveState("saved");
    setNoteDraft(null);
    if (!isPengli) window.setTimeout(() => setSaveState(""), 1800);
  }

  async function saveMedtechSelection() {
    await saveSelection("note", {
      title: selectedText.slice(0, 32) || "醫檢學習筆記",
      content: selectedText,
      originalContent: selectedText,
      subject: "醫檢師｜臨床病毒學",
      tags: "醫檢師、待複習",
      sourceLabel: "醫檢師引導學習",
    });
  }

  async function organizeNote() {
    if (organizeState === "organizing") return;
    setOrganizeState("organizing");
    const source = noteFromLookup();
    try {
      const response = await fetch("/api/notes/organize", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(source),
      });
      const data = (await response.json()) as {
        note?: NoteDraft;
        usage?: ExplainUsage;
        reused?: boolean;
        error?: string;
      };
      if (!response.ok || !data.note) {
        setOrganizeState("error");
        return;
      }
      setNoteDraft({
        ...data.note,
        originalContent: source.content,
        usage: data.usage,
        reused: data.reused,
      });
      setOrganizeState("");
    } catch {
      setOrganizeState("error");
    }
  }

  const close = () => {
    setLookup(null);
    setSelectedText("");
    setLawQuery("");
    setJudicialQuery(null);
  };
  return (
    <>
      {selectedText && position && (
        <div
          ref={selectionBarRef}
          className={`smart-selection-bar global-selection-bar ${position.placement} ${editingSelection ? "editing" : ""}`}
          style={{ left: position.left, top: position.top }}
        >
          {editingSelection ? (
            <input
              autoFocus
              aria-label="編輯框選文字"
              value={selectedText}
              onChange={(event) => applySelectedText(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") setEditingSelection(false);
                if (event.key === "Escape") dismiss(true);
              }}
            />
          ) : (
            <span>已框選：{selectedText}</span>
          )}
          {isMedtech ? (
            <>
              <button
                type="button"
                onClick={() => void saveMedtechSelection()}
                disabled={saveState === "saving" || saveState === "saved"}
              >
                {saveState === "saving"
                  ? "儲存中…"
                  : saveState === "saved"
                    ? "已加入 ✓"
                    : "加入筆記"}
              </button>
            </>
          ) : isAccounting ? (
            <>
              <button
                type="button"
                className="selection-edit-button"
                onClick={() => setEditingSelection((current) => !current)}
              >
                {editingSelection ? "完成" : "編輯"}
              </button>
              <button type="button" onClick={() => void explain()}>
                中會白話說明
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                className="selection-edit-button"
                onClick={() => setEditingSelection((current) => !current)}
              >
                {editingSelection ? "完成" : "編輯"}
              </button>
              {judicialQuery ? (
                <button type="button" onClick={() => void searchJudicial()}>
                  裁判搜尋
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => void searchLaw()}
                  disabled={!lawQuery}
                  title={
                    lawQuery
                      ? `搜尋 ${lawQuery}`
                      : "請先編輯為單一、完整的法規名稱與條號"
                  }
                >
                  法條搜尋
                </button>
              )}
              <button type="button" onClick={() => void explain()}>
                白話解釋
              </button>
            </>
          )}
          <button
            type="button"
            aria-label="關閉框選工具"
            onClick={() => dismiss(true)}
          >
            ×
          </button>
        </div>
      )}
      {lookup && (
        <div
          className="law-lookup-backdrop"
          role="presentation"
          onMouseDown={close}
        >
          <aside
            className="law-lookup-panel"
            role="dialog"
            aria-modal="true"
            aria-label="智能框選結果"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header>
              <div>
                <span>
                  {isMedtech
                    ? "醫檢 AI 助教｜專有名詞解析"
                    : isAccounting
                      ? "Luna 助教｜中會白話說明"
                    : lookup.mode === "explain"
                        ? isPengli ? "彭狸 AI 教練｜白話解釋" : "AI 法律助教｜辨識與拆解"
                        : lookup.decision
                          ? "司法院裁判資料庫｜已下載資料"
                          : "全國法規資料庫｜已下載資料"}
                </span>
                <h3>{selectedText || "框選內容"}</h3>
              </div>
              <button type="button" onClick={close} aria-label="關閉">
                ×
              </button>
            </header>
            {lookup.loading ? (
              <p className="law-lookup-status">
                {isMedtech
                  ? "正在整理中文、英文與臨床檢驗重點…"
                  : lookup.mode === "explain"
                    ? "正在辨識法律類型並進行白話拆解…"
                    : "正在查詢已下載的法規／裁判資料…"}
              </p>
            ) : lookup.mode === "explain" &&
              !lookup.article &&
              !lookup.decision ? (
              <>
                {lookup.error ? (
                  <div className="law-lookup-status error">
                    <p>{lookup.error}</p>
                    {isPengli && lookup.canAiFallback && (
                      <button type="button" onClick={() => void explain(true)}>
                        改由 AI 試著白話解釋
                      </button>
                    )}
                  </div>
                ) : (
                  <section className="legal-analysis-card">
                    <small>框選內容</small>
                    <h4>{selectedText}</h4>
                    {lookup.analysis && (
                      <div className="legal-analysis-grid">
                        {lookup.analysis.kind && (
                          <div>
                            <span>{isMedtech ? "名詞類型" : "類型"}</span>
                            <b>{lookup.analysis.kind}</b>
                          </div>
                        )}
                        {lookup.analysis.officialName && (
                          <div>
                            <span>{isMedtech ? "中英文名稱" : "正式名稱"}</span>
                            <b>{lookup.analysis.officialName}</b>
                          </div>
                        )}
                        {lookup.analysis.legalField && (
                          <div>
                            <span>{isMedtech ? "醫檢領域" : "法領域"}</span>
                            <b>{lookup.analysis.legalField}</b>
                          </div>
                        )}
                        {lookup.analysis.nature && (
                          <div>
                            <span>{isMedtech ? "臨床用途" : "性質"}</span>
                            <b>{lookup.analysis.nature}</b>
                          </div>
                        )}
                        {lookup.analysis.reference && (
                          <div>
                            <span>{isMedtech ? "縮寫／辨識" : "法條拆解"}</span>
                            <b>{lookup.analysis.reference}</b>
                          </div>
                        )}
                        {lookup.analysis.verification && (
                          <div>
                            <span>{isMedtech ? "國考重點" : "查證來源"}</span>
                            <b>{lookup.analysis.verification}</b>
                          </div>
                        )}
                      </div>
                    )}
                    {lookup.analysis?.points?.length ? (
                      <div className="legal-analysis-points">
                        <b>拆解重點</b>
                        <ul>
                          {lookup.analysis.points.map((point, index) => (
                            <li key={index}>{point}</li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                    <div className="law-plain-explanation">
                      <b>
                        {isMedtech
                          ? "醫檢白話解析"
                          : isAccounting
                            ? "中會白話說明"
                            : "白話解釋"}
                      </b>
                      <p>{lookup.explanation}</p>
                      {lookup.analysis?.caveat && (
                        <small>{lookup.analysis.caveat}</small>
                      )}
                    </div>
                    {isMedtech && lookup.access && (
                      <div className="medtech-feature-access">
                        <b>
                          {lookup.access.creditCost > 0
                            ? "本次已扣 1 點"
                            : "本次免費體驗"}
                        </b>
                        <span>
                          名詞解析免費剩餘 {lookup.access.freeRemaining} 次 ·
                          目前點數 {lookup.access.pointsRemaining} 點
                        </span>
                      </div>
                    )}
                    {isPengli && lookup.coachAccess && (
                      <div className="medtech-feature-access">
                        <b>{lookup.coachAccess.charged ? "已完成5次，本輪扣1次" : `完整學習第 ${lookup.coachAccess.coachRoundsUsed ?? 0}／${lookup.coachAccess.coachRoundsTarget ?? 5} 組`}</b>
                        <span>每完成5組完整學習扣1個 AI 次數（整理筆記包含在同一組）・目前剩餘 {lookup.coachAccess.remaining ?? "—"} 次</span>
                      </div>
                    )}
                    {lookup.usage && !isPengli && (
                      <div className="law-usage-meta">
                        <b>
                          {lookup.usage.model.replace("gpt-5.6-", "")}｜
                          {isMedtech
                            ? "AI 醫檢白話解析"
                            : "AI 法律辨識與白話解釋"}
                        </b>
                        <span>
                          輸入 {lookup.usage.inputTokens.toLocaleString()} ·
                          輸出 {lookup.usage.outputTokens.toLocaleString()} ·
                          合計{" "}
                          {(
                            lookup.usage.inputTokens + lookup.usage.outputTokens
                          ).toLocaleString()}{" "}
                          tokens
                        </span>
                        <span>
                          耗時 {lookup.usage.durationMs.toLocaleString()} ms ·
                          US$ {lookup.usage.estimatedCostUsd.toFixed(6)} · 約
                          NT${" "}
                          {(lookup.usage.estimatedCostUsd * 32.5).toFixed(4)}
                        </span>
                      </div>
                    )}
                  </section>
                )}
              </>
            ) : lookup.article ? (
              <>
                <section>
                  <small>
                    {lookup.article.title}
                    {lookup.article.hierarchy
                      ? `｜${lookup.article.hierarchy}`
                      : ""}
                  </small>
                  <h4>{lookup.article.articleNo}</h4>
                  <p>{lookup.article.content}</p>
                  {lookup.article.modifiedDate && (
                    <time>資料異動日期：{lookup.article.modifiedDate}</time>
                  )}
                  {lookup.article.articleNo !== "白話解釋" && (
                    <div className="law-usage-meta">
                      <b>資料庫查詢</b>
                      <span>未使用 AI · 0 tokens</span>
                      <span>本次 AI 成本 NT$ 0</span>
                    </div>
                  )}
                </section>
                {lookup.article.articleNo !== "白話解釋" && (
                  <footer>
                    <button
                      type="button"
                      onClick={() => void explain()}
                      disabled={lookup.explaining}
                    >
                      {lookup.explaining ? "正在解釋…" : "白話解釋"}
                    </button>
                    {lookup.article.sourceUrl && (
                      <a
                        href={lookup.article.sourceUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        查看官方來源 ↗
                      </a>
                    )}
                  </footer>
                )}
                {lookup.explanation && (
                  <section className="law-plain-explanation">
                    <b>白話解釋</b>
                    <p>{lookup.explanation}</p>
                    <small>
                      解釋以框選內容與顯示的條文為依據，不取代老師解析。
                    </small>
                    {lookup.usage && !isPengli && (
                      <div className="law-usage-meta">
                        <b>
                          {lookup.usage.model.replace("gpt-5.6-", "")}｜AI
                          白話解釋
                        </b>
                        <span>
                          輸入 {lookup.usage.inputTokens.toLocaleString()} ·
                          輸出 {lookup.usage.outputTokens.toLocaleString()} ·
                          合計{" "}
                          {(
                            lookup.usage.inputTokens + lookup.usage.outputTokens
                          ).toLocaleString()}{" "}
                          tokens
                        </span>
                        <span>
                          耗時 {lookup.usage.durationMs.toLocaleString()} ms ·
                          US$ {lookup.usage.estimatedCostUsd.toFixed(6)} · 約
                          NT${" "}
                          {(lookup.usage.estimatedCostUsd * 32.5).toFixed(4)}
                        </span>
                      </div>
                    )}
                  </section>
                )}
              </>
            ) : lookup.decision ? (
              <>
                <section>
                  <small>
                    {lookup.decision.court}｜
                    {lookup.decision.judgmentDate || "裁判日期未載"}
                  </small>
                  <h4>
                    {lookup.decision.year}年度{lookup.decision.caseType}字第
                    {lookup.decision.caseNo}號
                  </h4>
                  <p>
                    {lookup.decision.fullText ||
                      lookup.decision.excerpt ||
                      "平台目前只有裁判索引，尚無全文。"}
                  </p>
                  <div className="law-usage-meta">
                    <b>裁判資料庫查詢</b>
                    <span>未使用 AI · 0 tokens</span>
                    <span>本次 AI 成本 NT$ 0</span>
                  </div>
                </section>
                <footer>
                  <button
                    type="button"
                    onClick={() => void explain()}
                    disabled={lookup.explaining}
                  >
                    {lookup.explaining ? "正在解釋…" : "白話解釋"}
                  </button>
                  <a
                    href="https://judgment.judicial.gov.tw/FJUD/default.aspx"
                    target="_blank"
                    rel="noreferrer"
                  >
                    到司法院查詢 ↗
                  </a>
                </footer>
                {lookup.explanation && (
                  <section className="law-plain-explanation">
                    <b>白話解釋</b>
                    <p>{lookup.explanation}</p>
                    <small>解釋以顯示的裁判內容為依據，不取代老師解析。</small>
                    {lookup.usage && !isPengli && (
                      <div className="law-usage-meta">
                        <b>
                          {lookup.usage.model.replace("gpt-5.6-", "")}｜AI
                          白話解釋
                        </b>
                        <span>
                          輸入 {lookup.usage.inputTokens.toLocaleString()} ·
                          輸出 {lookup.usage.outputTokens.toLocaleString()} ·
                          合計{" "}
                          {(
                            lookup.usage.inputTokens + lookup.usage.outputTokens
                          ).toLocaleString()}{" "}
                          tokens
                        </span>
                        <span>
                          耗時 {lookup.usage.durationMs.toLocaleString()} ms ·
                          US$ {lookup.usage.estimatedCostUsd.toFixed(6)} · 約
                          NT${" "}
                          {(lookup.usage.estimatedCostUsd * 32.5).toFixed(4)}
                        </span>
                      </div>
                    )}
                  </section>
                )}
              </>
            ) : (
              <div className="law-lookup-status error">
                <p>{lookup.error}</p>
                {judicialQuery && (
                  <small>
                    {judicialQuery.court}｜{judicialQuery.year}年度｜
                    {judicialQuery.caseType}字｜第{judicialQuery.caseNo}號
                  </small>
                )}
                <div className="official-search-fallback">
                  <b>已整理並複製搜尋關鍵字</b>
                  <span>選擇官方網站後，可直接貼入搜尋欄。</span>
                  <div>
                    <button
                      type="button"
                      onClick={() =>
                        void openOfficialSearch("https://law.moj.gov.tw/")
                      }
                    >
                      全國法規資料庫 ↗
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        void openOfficialSearch(
                          "https://judgment.judicial.gov.tw/FJUD/default.aspx",
                        )
                      }
                    >
                      司法院裁判書 ↗
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        void openOfficialSearch(
                          "https://cons.judicial.gov.tw/judsearch.aspx?fid=46",
                        )
                      }
                    >
                      憲法法庭 ↗
                    </button>
                  </div>
                </div>
              </div>
            )}
            {lookup.error && lookup.article && (
              <p className="law-lookup-status error">{lookup.error}</p>
            )}
            {!lookup.loading && !lookup.error && (
              <div className="selection-save-actions">
                {isPengli ? (
                  <>
                    {lookup.explanation && (
                      <details open className="pengli-auto-note-preview">
                        <summary>本次自動筆記預覽</summary>
                        <h4>{selectedText.slice(0, 32) || "行政法白話筆記"}</h4>
                        <p style={{ whiteSpace: "pre-wrap" }}>{lookup.explanation}</p>
                        <small>來源狀態：{lookup.sourceStatus || (lookup.aiFallback ? "AI 補充" : "彭狸老師教材")}</small>
                      </details>
                    )}
                    <span>{saveState === "saving" ? "正在自動加入彭狸筆記…" : saveState === "error" ? "自動加入筆記未完成" : "已自動加入彭狸筆記 ✓"}</span>
                    <a href="/teachers/pengli/notes">前往我的筆記 →</a>
                  </>
                ) : isMedtech ? (
                  <>
                    <button
                      type="button"
                      className="primary"
                      onClick={() => void saveSelection("note")}
                      disabled={saveState === "saving" || saveState === "saved"}
                    >
                      {saveState === "saving"
                        ? "儲存中…"
                        : saveState === "saved"
                          ? "已加入醫檢筆記 ✓"
                          : "＋ 將解析加入醫檢筆記"}
                    </button>
                    <small>
                      醫檢筆記前 5 筆免費，第 6 筆起每筆扣 1
                      點；查看與編輯不扣點。
                    </small>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => void saveSelection("favorite")}
                      disabled={saveState === "saving" || saveState === "saved"}
                    >
                      {saveState === "saved"
                        ? "已收藏原文 ✓"
                        : "☆ 快速收藏原文"}
                    </button>
                    <button
                      type="button"
                      className="primary"
                      onClick={() => void organizeNote()}
                      disabled={organizeState === "organizing"}
                    >
                      {organizeState === "organizing"
                        ? "AI 正在整理…"
                        : "＋ AI 整理成筆記"}
                    </button>
                    <a href={isPengli ? "/teachers/pengli/notes" : "/notes"}>前往我的筆記 →</a>
                  </>
                )}
                {saveState === "error" && (
                  <small>{saveMessage || "目前無法保存，請稍後再試。"}</small>
                )}
                {organizeState === "error" && (
                  <small>AI 整理未完成，請再試一次。</small>
                )}
              </div>
            )}
          </aside>
        </div>
      )}
      {noteDraft && (
        <div
          className="selection-note-backdrop"
          role="presentation"
          onMouseDown={() => setNoteDraft(null)}
        >
          <form
            className="selection-note-editor"
            onSubmit={(event) => {
              event.preventDefault();
              void saveSelection("note", noteDraft);
            }}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header>
              <div>
                <span>AI 整理成筆記</span>
                <h3>預覽與編輯</h3>
              </div>
              <button
                type="button"
                onClick={() => setNoteDraft(null)}
                aria-label="關閉"
              >
                ×
              </button>
            </header>
            <label>
              標題
              <input
                value={noteDraft.title}
                onChange={(event) =>
                  setNoteDraft({ ...noteDraft, title: event.target.value })
                }
                required
              />
            </label>
            <div className="selection-note-fields">
              <label>
                科目
                <input
                  value={noteDraft.subject}
                  onChange={(event) =>
                    setNoteDraft({ ...noteDraft, subject: event.target.value })
                  }
                />
              </label>
              <label>
                標籤
                <input
                  value={noteDraft.tags}
                  onChange={(event) =>
                    setNoteDraft({ ...noteDraft, tags: event.target.value })
                  }
                  placeholder="重要、待複習"
                />
              </label>
            </div>
            <label>
              結構化筆記
              <textarea
                rows={13}
                value={noteDraft.content}
                onChange={(event) =>
                  setNoteDraft({ ...noteDraft, content: event.target.value })
                }
                required
              />
            </label>
            <small>
              儲存後只建立一筆筆記；AI
              整理與原始收藏會一起保留，可在筆記中切換查看。
            </small>
            {noteDraft.usage && !isPengli && (
              <div className="note-organize-usage">
                <b>
                  {noteDraft.reused
                    ? "快取命中｜沿用先前 AI 整理"
                    : `${noteDraft.usage.model.replace("gpt-5.6-", "")}｜AI 筆記整理`}
                </b>
                <span>
                  輸入 {noteDraft.usage.inputTokens.toLocaleString()} · 輸出{" "}
                  {noteDraft.usage.outputTokens.toLocaleString()} · 合計{" "}
                  {(
                    noteDraft.usage.inputTokens + noteDraft.usage.outputTokens
                  ).toLocaleString()}{" "}
                  tokens
                </span>
                <span>
                  耗時 {noteDraft.usage.durationMs.toLocaleString()} ms · US${" "}
                  {noteDraft.usage.estimatedCostUsd.toFixed(6)} · 約 NT${" "}
                  {(noteDraft.usage.estimatedCostUsd * 32.5).toFixed(4)}
                </span>
              </div>
            )}
            <footer>
              <button type="button" onClick={() => setNoteDraft(null)}>
                取消
              </button>
              <button
                type="submit"
                className="primary"
                disabled={saveState === "saving"}
              >
                {saveState === "saving" ? "儲存中…" : "儲存筆記（含原文）"}
              </button>
            </footer>
          </form>
        </div>
      )}
    </>
  );
}
