"use client";
import { useEffect, useRef, useState } from "react";
import { strToU8, zipSync } from "fflate";
import { RichQuestionEditor } from "../RichQuestionEditor";
import { QuestionMediaPanel } from "./QuestionMediaPanel";
import { QuestionProofreadDialog } from "./QuestionProofreadDialog";
import { ManualQuestionDialog } from "./ManualQuestionDialog";
import { RepairMissingQuestionsButton } from "./RepairMissingQuestionsButton";
import "../question-bank.css";
import "../question-workbench.css";
import "./page.css";
import "./library.css";
import "./evidence.css";
import "./quality-repair.css";
type QualityAcknowledgement = {
  warning: string;
  confirmedAt: string;
  confirmedBy: string;
};
type Question = {
  id: number;
  examType?: string;
  year: string;
  subject: string;
  questionNumber: string;
  stem: string;
  options: Record<string, string>;
  correctAnswer: string | null;
  teacherAnswer?: string;
  answerStatus?: string;
  explanation: string;
  aiCompleteExplanation?: string;
  teacherCompleteExplanation?: string;
  completeExplanation?: string;
  voiceScript?: string;
  narrationScript?: string;
  answerSource: string;
  status: string;
  reviewStatus?: "pending" | "confirmed";
  reviewedAt?: string | Date | null;
  isSimulation?: boolean;
  simulatedAnswer?: string;
  simulatedExplanation?: string;
  simulatedCompleteExplanation?: string;
  simulatedSource?: string;
  simulatedAnswerStatus?: string;
  simulatedTeacherNote?: string;
  sourceOrder?: number | null;
  qualityAcknowledgements?: QualityAcknowledgement[];
};
type SourceVariant = {
  kind: string;
  fileName: string;
  contentType?: string;
  sizeBytes?: number;
  storageKey?: string;
};
type Doc = {
  id: number;
  name: string;
  subject: string;
  type: string;
  processingStage: string;
  questionCount: number;
  indexedQuestionCount?: number;
  sourceVariants?: SourceVariant[];
};
function richTextToPlain(value: string) {
  if (typeof document === "undefined")
    return String(value ?? "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  const root = document.createElement("div");
  root.innerHTML = String(value ?? "");
  root.querySelectorAll("br").forEach((node) => node.replaceWith("\n"));
  root.querySelectorAll("p,div,li,tr").forEach((node) => node.append("\n"));
  root.querySelectorAll("td,th").forEach((node) => node.append(" | "));
  return (root.textContent ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
function questionText(question: Question, separateCompleteExplanation = false) {
  const options = Object.entries(question.options ?? {}).filter(([, value]) =>
    String(value ?? "").trim(),
  );
  const explanation = richTextToPlain(question.explanation);
  const aiCompleteExplanation = richTextToPlain(
    question.aiCompleteExplanation ??
      (question.isSimulation
        ? (question.simulatedCompleteExplanation ?? "")
        : ""),
  );
  const teacherCompleteExplanation = richTextToPlain(
    question.teacherCompleteExplanation ?? question.completeExplanation ?? "",
  );
  const narrationScript = richTextToPlain(
    question.teacherCompleteExplanation ||
      question.completeExplanation ||
      question.aiCompleteExplanation ||
      (question.isSimulation ? question.simulatedCompleteExplanation : "") ||
      question.voiceScript ||
      "",
  );
  if (separateCompleteExplanation) return narrationScript;
  const explanationBlocks = separateCompleteExplanation
    ? [
        "【解析（題目原有簡要解析）】",
        explanation || "題目原稿未附簡要解析。",
        "",
        "【AI 完整解析（AI 版）】",
        aiCompleteExplanation || "尚未產生 AI 完整解析。",
        "",
        "【老師完整解析】",
        teacherCompleteExplanation || "尚未補充老師完整解析。",
        "",
        "【語音解析腳本】",
        narrationScript || "尚未產生完整解析文字。",
        "",
        `【完整解析狀態】AI：${aiCompleteExplanation ? "已有" : "待補充"}；老師：${teacherCompleteExplanation ? "已有" : "待補充"}；語音腳本：${narrationScript ? "已有" : "待補充"}`,
      ]
    : [
        "【完整解析（老師／語音文本）】",
        teacherCompleteExplanation || explanation || "尚未補充完整解析。",
        "",
        `【解析狀態】${teacherCompleteExplanation || explanation ? "已有文字，可送審或製作語音" : "待補充"}`,
      ];
  return (
    [
      `科目：${question.subject || "未分類"}`,
      `來源／年份：${question.year || "未標示"}`,
      `題號：${question.questionNumber || "未標示"}`,
      "",
      "【題目】",
      richTextToPlain(question.stem) || "（題目尚未完成）",
      "",
      "【選項】",
      ...(options.length
        ? options.map(
            ([key, value]) => `${key}. ${richTextToPlain(String(value))}`,
          )
        : ["（選項尚未完成）"]),
      "",
      `【正確答案】${question.correctAnswer || "未設定"}`,
      "",
      ...explanationBlocks,
    ].join("\n") + "\n"
  );
}
function safeQuestionFileName(question: Question, index: number) {
  const raw = (question.questionNumber || String(index + 1)).replace(
    /[\\/:*?"<>|]/g,
    "-",
  );
  return `${String(index + 1).padStart(3, "0")}_q${question.id}_第${raw}題.txt`;
}
type WorkspacePosition = {
  questionId?: number;
  pdfPage?: number;
  questionSearch?: string;
  qualityFilter?: QualityFilter;
  richEditorOpen?: boolean;
};
function workspacePositionKey(documentId: number) {
  return `document-workspace-position:${documentId}`;
}
function downloadFile(data: BlobPart, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function searchableQuestionText(question: Question) {
  return [
    question.year,
    question.subject,
    question.questionNumber,
    question.stem,
    ...Object.values(question.options ?? {}),
    question.explanation,
    question.aiCompleteExplanation ?? "",
    question.teacherCompleteExplanation ?? "",
    question.completeExplanation ?? "",
    question.answerSource,
  ]
    .join(" ")
    .replace(/<[^>]+>/g, " ")
    .toLocaleLowerCase();
}
type QualityFilter =
  | "all"
  | "missing-answer"
  | "missing-options"
  | "option-contamination"
  | "garbled"
  | "spacing"
  | "linebreak"
  | "type";
type DismissibleQualityFilter =
  "missing-answer" | "garbled" | "spacing" | "linebreak" | "type";
const dismissibleQualityWarnings = new Set<DismissibleQualityFilter>([
  "missing-answer",
  "garbled",
  "spacing",
  "linebreak",
  "type",
]);
function hasQualityAcknowledgement(
  question: Question,
  warning: DismissibleQualityFilter,
) {
  return (question.qualityAcknowledgements ?? []).some(
    (item) => item.warning === warning,
  );
}
function hasSuspiciousLineBreak(value: string) {
  return /[\u4e00-\u9fff](?:\s*<br\s*\/?\s*>\s*|\r?\n\s*)[\u4e00-\u9fff]/iu.test(
    value || "",
  );
}
function removeSuspiciousLineBreaks(value: string) {
  return String(value || "").replace(
    /([\u4e00-\u9fff])(?:\s*<br\s*\/?\s*>\s*|\r?\n\s*)(?=[\u4e00-\u9fff])/giu,
    "$1",
  );
}
function removeSuspiciousSpacing(value: string) {
  return String(value || "")
    .split(/(<[^>]+>)/g)
    .map((part) =>
      part.startsWith("<")
        ? part
        : part
            .replace(
              /([\u4e00-\u9fff])\s+(?=[\u4e00-\u9fffA-Za-z0-9$％%])/gu,
              "$1",
            )
            .replace(/([A-Za-z0-9])\s+(?=[\u4e00-\u9fff])/gu, "$1")
            .replace(
              /([，。；：、（）])\s+(?=[\u4e00-\u9fffA-Za-z0-9])/gu,
              "$1",
            ),
    )
    .join("");
}
function suggestedExamType(question: Question) {
  const options = Object.values(question.options ?? {}).some((value) =>
    Boolean(richTextToPlain(value)),
  );
  if (options) return "mcq";
  const text = richTextToPlain(
    `${question.stem || ""} ${question.explanation || ""}`,
  );
  if (
    /(?:計算|求算|分錄|金額|比率|每股|損益|成本|現值|終值|\$|＝|=)/u.test(text)
  )
    return "calculation";
  if (
    /(?:申論|試論|評析|評論|分析|討論|說明.*理由|比較.*異同|請詳述|闡述)/u.test(
      text,
    ) ||
    text.length > 420
  )
    return "essay";
  return "short_answer";
}
function qualityFlags(question: Question) {
  const plain = (value: string) => richTextToPlain(String(value ?? ""));
  const options = ["A", "B", "C", "D"].map((key) =>
    plain(question.options?.[key] ?? ""),
  );
  const answer = String(question.teacherAnswer || question.correctAnswer || "")
    .trim()
    .toUpperCase();
  const openEnded = ["essay", "short_answer", "calculation"].includes(
    question.examType || "",
  );
  const hasAllOptions = options.every(Boolean),
    hasAnyOptions = options.some(Boolean);
  const inferredOpenEnded =
    !openEnded &&
    !hasAnyOptions &&
    Boolean(plain(question.stem) || plain(question.explanation));
  const allText = [plain(question.stem), ...options].join(" ");
  const flags = {
    "missing-answer":
      !openEnded && !inferredOpenEnded && !/^[A-D]$/.test(answer),
    "missing-options": !openEnded && !inferredOpenEnded && !hasAllOptions,
    "option-contamination":
      !openEnded &&
      !inferredOpenEnded &&
      options.some((value) =>
        /(?:解析|解答|計算過程|答案)\s*[：:]/u.test(value),
      ),
    garbled: /[\uE000-\uF8FF�]/u.test(
      [
        question.stem,
        ...options,
        question.teacherAnswer || "",
        question.explanation,
      ].join(" "),
    ),
    spacing: /(?:[\u4e00-\u9fff]\s+){3,}[\u4e00-\u9fff]/u.test(allText),
    linebreak: [
      question.stem,
      ...Object.values(question.options ?? {}),
      question.explanation,
    ].some(hasSuspiciousLineBreak),
    type: (openEnded && hasAllOptions) || inferredOpenEnded,
  };
  const acknowledged = new Set(
    (question.qualityAcknowledgements ?? []).map((item) => item.warning),
  );
  for (const key of dismissibleQualityWarnings)
    if (acknowledged.has(key)) flags[key] = false;
  return flags;
}
function qualityReasons(question: Question) {
  const found = qualityFlags(question),
    reasons: {
      key: Exclude<QualityFilter, "all">;
      level: "P0" | "P1";
      text: string;
    }[] = [];
  if (found["missing-answer"])
    reasons.push({
      key: "missing-answer",
      level: "P0",
      text: "缺少有效老師答案",
    });
  if (found["missing-options"])
    reasons.push({
      key: "missing-options",
      level: "P0",
      text: "A～D 選項不完整",
    });
  if (found["option-contamination"])
    reasons.push({
      key: "option-contamination",
      level: "P0",
      text: "解析或答案疑似混入選項",
    });
  if (found.garbled)
    reasons.push({
      key: "garbled",
      level: "P0",
      text: "偵測到亂碼、私人使用區或無法辨識的特殊字元",
    });
  if (found.spacing)
    reasons.push({
      key: "spacing",
      level: "P1",
      text: "偵測到中文字間異常空格",
    });
  if (found.linebreak)
    reasons.push({
      key: "linebreak",
      level: "P1",
      text: "疑似中文字被強制斷行",
    });
  if (found.type)
    reasons.push({
      key: "type",
      level: "P1",
      text: `題型疑似誤判；系統建議標為${suggestedExamType(question) === "essay" ? "申論題" : suggestedExamType(question) === "calculation" ? "計算題" : "簡答題"}`,
    });
  return reasons;
}
function compareQuestionOrder(left: Question, right: Question) {
  const leftOrder = Number(left.sourceOrder ?? 0);
  const rightOrder = Number(right.sourceOrder ?? 0);
  if (leftOrder > 0 && rightOrder > 0)
    return leftOrder - rightOrder || left.id - right.id;
  if (leftOrder > 0) return -1;
  if (rightOrder > 0) return 1;
  return left.id - right.id;
}
export default function DocumentQuestionWorkspace({
  category = "medtech",
  central = false,
}: {
  category?: "medtech" | "accounting" | "data-structure";
  central?: boolean;
}) {
  const accounting = category === "accounting";
  const dataStructure = category === "data-structure";
  const categoryPaths =
    category === "data-structure"
      ? {
          docs: "/api/data-structure/documents",
          questions: "/api/data-structure/admin/questions",
          import: "/api/data-structure/import",
          process: "/api/data-structure/documents/process",
          source: "/api/data-structure/admin/document-source",
          html: "/api/data-structure/admin/document-html",
          page: "/api/data-structure/admin/document-page",
          back: "/admin/question-bank",
          workspace: "/admin/question-bank/workspace?category=data-structure",
        }
      : accounting
        ? {
            docs: "/api/accounting/documents",
            questions: "/api/accounting/admin/questions",
            import: "/api/accounting/import",
            process: "/api/accounting/documents/process",
            source: "/api/accounting/admin/document-source",
            html: "/api/accounting/admin/document-html",
            page: "/api/accounting/admin/document-page",
            back: "/accounting/admin",
            workspace: "/accounting/admin/document-workspace",
          }
        : {
            docs: "/api/medtech/documents",
            questions: "/api/medtech/admin/questions",
            import: "/api/medtech/import",
            process: "/api/medtech/documents/process",
            source: "/api/medtech/admin/document-source",
            html: "/api/medtech/admin/document-html",
            page: "/api/medtech/admin/document-page",
            back: "/medtech/admin/document-library",
            workspace: "/medtech/admin/document-workspace",
          };
  const paths = central
    ? {
        ...categoryPaths,
        back:
          category === "medtech"
            ? "/medtech/admin/document-library"
            : "/admin/question-bank",
        workspace: `/admin/question-bank/workspace?category=${category}`,
      }
    : categoryPaths;
  const [questions, setQuestions] = useState<Question[]>([]),
    [current, setCurrent] = useState<Question | null>(null),
    [docs, setDocs] = useState<Doc[]>([]),
    [docName, setDocName] = useState(""),
    [contentType, setContentType] = useState(""),
    [sourceVariants, setSourceVariants] = useState<SourceVariant[]>([]),
    [sourceMode, setSourceMode] = useState<"primary" | "pdf" | "html">(
      "primary",
    ),
    [sourceRevision, setSourceRevision] = useState(0),
    [pdfPreviewUrl, setPdfPreviewUrl] = useState(""),
    [cachedPdfUrl, setCachedPdfUrl] = useState(""),
    [sourceError, setSourceError] = useState(""),
    [htmlLoading, setHtmlLoading] = useState(false),
    [htmlAttempted, setHtmlAttempted] = useState(false),
    [loading, setLoading] = useState(true),
    [saving, setSaving] = useState(false),
    [batchRepairing, setBatchRepairing] = useState(false),
    [replaceBusy, setReplaceBusy] = useState(false),
    [replaceText, setReplaceText] = useState(""),
    [importing, setImporting] = useState(0),
    [notice, setNotice] = useState(""),
    [questionSearch, setQuestionSearch] = useState(""),
    [answerDiffOnly, setAnswerDiffOnly] = useState(false),
    [aiGenerating, setAiGenerating] = useState(false),
    [richEditorOpen, setRichEditorOpen] = useState(false),
    [qualityMode, setQualityMode] = useState(false),
    [qualityFilter, setQualityFilter] = useState<QualityFilter>("all");
  const [documentId, setDocumentId] = useState(0),
    [pdfPage, setPdfPage] = useState(1),
    [locating, setLocating] = useState(false);
  const autoImportStarted = useRef(false);
  const restoringPosition = useRef(false);
  const replacementInput = useRef<HTMLInputElement>(null);
  const pendingSelectedId = useRef<number | null>(null);
  useEffect(() => {
    if (!questions.length) return;
    setQuestions((list) => {
      const sorted = [...list].sort(compareQuestionOrder);
      return sorted.every((item, index) => item.id === list[index]?.id)
        ? list
        : sorted;
    });
  }, [questions.length]);
  useEffect(() => {
    if (!pendingSelectedId.current) return;
    const selected = questions.find(
      (item) => item.id === pendingSelectedId.current,
    );
    if (selected) {
      setCurrent(selected);
      pendingSelectedId.current = null;
    }
  }, [questions]);
  useEffect(() => {
    if (restoringPosition.current) {
      restoringPosition.current = false;
      return;
    }
    setRichEditorOpen(false);
  }, [current?.id]);
  useEffect(() => {
    const handle = (event: Event) => {
      const id = (event as CustomEvent<{ id?: number }>).detail?.id;
      if (typeof id === "number") pendingSelectedId.current = id;
    };
    window.addEventListener("medtech-question-created", handle);
    return () => window.removeEventListener("medtech-question-created", handle);
  }, []);
  useEffect(() => {
    const handle = (event: Event) => {
      const detail = (
        event as CustomEvent<{ id?: number; item?: Partial<Question> }>
      ).detail;
      if (!detail?.id || !detail.item) return;
      setQuestions((list) =>
        list.map((item) =>
          item.id === detail.id ? { ...item, ...detail.item } : item,
        ),
      );
      setCurrent((item) =>
        item?.id === detail.id ? { ...item, ...detail.item } : item,
      );
    };
    const filter = () => setAnswerDiffOnly(true);
    window.addEventListener("medtech-question-review-updated", handle);
    window.addEventListener("medtech-filter-answer-conflicts", filter);
    return () => {
      window.removeEventListener("medtech-question-review-updated", handle);
      window.removeEventListener("medtech-filter-answer-conflicts", filter);
    };
  }, []);
  useEffect(() => {
    const handle = (event: Event) => {
      const ids = new Set(
        (event as CustomEvent<{ ids?: number[] }>).detail?.ids ?? [],
      );
      if (!ids.size) return;
      setQuestions((list) =>
        list.map((item) =>
          ids.has(item.id) ? { ...item, reviewStatus: "confirmed" } : item,
        ),
      );
      setCurrent((item) =>
        item && ids.has(item.id)
          ? { ...item, reviewStatus: "confirmed" }
          : item,
      );
    };
    window.addEventListener("medtech-bulk-review-updated", handle);
    return () =>
      window.removeEventListener("medtech-bulk-review-updated", handle);
  }, []);
  useEffect(() => {
    if (!dataStructure) return;
    const handle = (event: Event) => {
      const examType = (event as CustomEvent<{ examType?: string }>).detail
        ?.examType;
      if (examType) setCurrent((item) => (item ? { ...item, examType } : item));
    };
    window.addEventListener("data-structure-question-type", handle);
    return () =>
      window.removeEventListener("data-structure-question-type", handle);
  }, [dataStructure]);
  async function load(id: number) {
    const [qr, dr] = await Promise.all([
      fetch(
        `${paths.questions}?documentId=${id}&limit=100&page=1&order=source`,
        { cache: "no-store" },
      ),
      fetch(`${paths.docs}?id=${id}`, { cache: "no-store" }),
    ]);
    const qd = (await qr.json()) as { items?: Question[]; total?: number };
    const all = [...(qd.items ?? [])];
    const pages = Math.ceil((qd.total ?? all.length) / 100);
    for (let page = 2; page <= pages; page += 1) {
      const response = await fetch(
        `${paths.questions}?documentId=${id}&limit=100&page=${page}&order=source`,
        { cache: "no-store" },
      );
      const data = (await response.json()) as { items?: Question[] };
      all.push(...(data.items ?? []));
    }
    all.sort((left, right) => {
      const leftOrder = Number(left.sourceOrder ?? 0);
      const rightOrder = Number(right.sourceOrder ?? 0);
      return leftOrder > 0 && rightOrder > 0 && leftOrder !== rightOrder
        ? leftOrder - rightOrder
        : left.id - right.id;
    });
    const dd = (await dr.json()) as { documents?: Doc[] };
    const doc = dd.documents?.find((x) => x.id === id);
    const name = doc?.name || `文件 ${id}`;
    const needsSourceRepair =
      /\.docx$/i.test(name) &&
      all.some(
        (item) =>
          item.year === "未標示考試來源" ||
          Object.values(item.options ?? {}).some((value) =>
            /計算過程|解答|解析/u.test(String(value)),
          ),
      );
    setDocName(name);
    setContentType(
      /\.pdf$/i.test(name)
        ? "pdf"
        : /\.html?$/i.test(name)
          ? "html"
          : /\.docx$/i.test(name)
            ? "docx"
            : "other",
    );
    const variants = doc?.sourceVariants ?? [];
    const storedHtml = variants.some((item) => item.kind === "html");
    const storedPdf = variants.some((item) => item.kind === "pdf");
    setSourceVariants(variants);
    setHtmlAttempted(storedHtml);
    setSourceMode(
      storedPdf && !/\.pdf$/i.test(name)
        ? "pdf"
        : /\.docx$/i.test(name) && storedHtml
          ? "html"
          : "primary",
    );
    let position: WorkspacePosition = {};
    try {
      position = JSON.parse(
        localStorage.getItem(workspacePositionKey(id)) || "{}",
      ) as WorkspacePosition;
    } catch {}
    const restored =
      all.find((item) => item.id === Number(position.questionId)) ??
      all[0] ??
      null;
    restoringPosition.current = Boolean(
      restored && restored.id === position.questionId,
    );
    setQuestions(all);
    setCurrent(restored);
    setPdfPage(Math.max(1, Number(position.pdfPage) || 1));
    setQuestionSearch(position.questionSearch || "");
    setQualityFilter(position.qualityFilter || "all");
    setRichEditorOpen(position.richEditorOpen === true);
    setLoading(false);
    return {
      loadedCount: all.length,
      indexedCount: Number(doc?.questionCount ?? 0),
      needsSourceRepair,
    };
  }
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const id = Number(params.get("id"));
    setQualityMode(params.get("quality") === "1");
    setDocumentId(id);
    if (id > 0)
      void load(id).then((result) => {
        const shouldMaterialize =
          result.indexedCount > 0 && result.loadedCount < result.indexedCount;
        const autoImport = params.get("autoImport") === "1";
        if (
          (autoImport || shouldMaterialize || result.needsSourceRepair) &&
          !autoImportStarted.current
        ) {
          autoImportStarted.current = true;
          if (shouldMaterialize && !result.needsSourceRepair)
            setNotice(
              `文件標示 ${result.indexedCount} 題，但目前只載入 ${result.loadedCount} 題，正在補齊其餘題目…`,
            );
          else if (
            result.needsSourceRepair &&
            !autoImport &&
            !shouldMaterialize
          )
            setNotice("正在修正題目的考試來源、年份與選項解析分界…");
          void importQuestions(id, shouldMaterialize);
        }
      });
    else
      fetch(paths.docs, { cache: "no-store" })
        .then((r) => r.json())
        .then((data: { documents?: Doc[] }) => setDocs(data.documents ?? []))
        .finally(() => setLoading(false));
  }, []);
  useEffect(() => {
    if (!documentId || loading || typeof caches === "undefined") return;
    let disposed = false,
      objectUrl = "";
    void caches
      .open("silu-document-originals-v1")
      .then((cache) => cache.match(`/__saved-original/pdf/${documentId}`))
      .then(async (response) => {
        if (!response || disposed) return;
        const blob = await response.blob();
        if (!blob.size || disposed) return;
        objectUrl = URL.createObjectURL(blob);
        setCachedPdfUrl(objectUrl);
        setDocName(
          decodeURIComponent(
            response.headers.get("x-original-file-name") ||
              `文件-${documentId}.pdf`,
          ),
        );
        setContentType("pdf");
        setSourceMode("primary");
        setNotice((value) => value || "已從本機保存區恢復 PDF 原稿。");
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [documentId, loading]);
  useEffect(() => {
    if (!documentId || contentType !== "docx" || htmlAttempted) return;
    setHtmlAttempted(true);
    setHtmlLoading(true);
    setNotice("正在建立 Word HTML 對照稿，完成後會保存供下次直接使用…");
    void fetch(`${paths.html}?id=${documentId}`, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok)
          throw new Error((await response.text()) || "Word HTML 對照建立失敗");
        setSourceMode("html");
        setNotice("Word HTML 對照稿已建立並保存。");
      })
      .catch((error) =>
        setNotice(
          error instanceof Error ? error.message : "Word HTML 對照建立失敗",
        ),
      )
      .finally(() => setHtmlLoading(false));
  }, [documentId, contentType, htmlAttempted]);
  async function importQuestions(
    id: number,
    materializeOnly = false,
    forceReparse = false,
  ) {
    setImporting(id);
    setNotice(
      forceReparse
        ? "正在重新讀取原始 PDF，完整拆解題目…"
        : materializeOnly
          ? "正在載入已完成的題目索引…"
          : "已開啟原稿，正在拆解題目…",
    );
    let offset = 0;
    for (let round = 0; round < 30; round += 1) {
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 30000);
      try {
        const response = await fetch(paths.import, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            documentId: id,
            offset,
            limit: materializeOnly ? 25 : 100,
            materializeOnly,
            forceReparse: forceReparse && offset === 0,
          }),
          signal: controller.signal,
        });
        const data = (await response.json()) as {
          done?: boolean;
          nextOffset?: number;
          parsed?: number;
          error?: string;
          imported?: number;
        };
        if (!response.ok) {
          setNotice(data.error || "未能載入題目，仍可查看原稿。請稍後再試。");
          setImporting(0);
          return;
        }
        const nextOffset = data.nextOffset ?? offset;
        if (nextOffset <= offset && !data.done) {
          setNotice("題目索引沒有繼續前進，請稍後再試。");
          setImporting(0);
          return;
        }
        offset = nextOffset;
        if (data.done) {
          await load(id);
          const total = data.parsed ?? offset;
          setNotice(
            forceReparse
              ? `重新拆題完成，已載入 ${total} 題。`
              : materializeOnly
                ? `已載入既有 ${total} 題。`
                : `拆題完成，已載入 ${total} 題。`,
          );
          setImporting(0);
          return;
        }
      } catch (error) {
        const message =
          error instanceof DOMException && error.name === "AbortError"
            ? "原始文件重新解析逾時，請稍後再按一次。"
            : `題目解析失敗：${error instanceof Error ? error.message : "未知錯誤"}`;
        setNotice(`${message} 原稿仍可查看。`);
        setImporting(0);
        return;
      } finally {
        window.clearTimeout(timeout);
      }
    }
    setNotice("拆題數量較多，請按「繼續拆題」接續處理。");
    setImporting(0);
  }
  function rebuildQuestions() {
    if (
      questions.length &&
      !confirm(
        `將以完整原稿重新拆題，並取代目前這份文件的 ${questions.length} 題。確定繼續？`,
      )
    )
      return;
    void importQuestions(documentId, false, true);
  }
  async function replaceSource(file: File) {
    if (
      !confirm(
        `確定新增「${file.name}」作為這份文件的另一個原稿版本？目前的 PDF／HTML、${questions.length} 題、解析與順序都會保留，不會重新拆題。`,
      )
    ) {
      if (replacementInput.current) replacementInput.current.value = "";
      return;
    }
    setImporting(documentId);
    try {
      const contentType =
        file.type ||
        (/\.pdf$/i.test(file.name)
          ? "application/pdf"
          : /\.docx$/i.test(file.name)
            ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            : "application/octet-stream");
      if (category === "medtech") {
        setNotice("正在上傳並驗證 PDF 原稿…");
        const form = new FormData();
        form.set("id", String(documentId));
        form.set("file", file);
        const response = await fetch(paths.docs, { method: "PUT", body: form });
        const result = (await response.json().catch(() => ({}))) as {
          error?: string;
          variant?: string;
          name?: string;
          persisted?: boolean;
        };
        if (!response.ok || !result.persisted)
          throw new Error(result.error || "PDF 上傳後未通過持久化驗證");
        if (/\.pdf$/i.test(file.name) && typeof caches !== "undefined") {
          const cache = await caches.open("silu-document-originals-v1");
          await cache.put(
            `/__saved-original/pdf/${documentId}`,
            new Response(file, {
              headers: {
                "content-type": "application/pdf",
                "x-original-file-name": encodeURIComponent(file.name),
              },
            }),
          );
          if (cachedPdfUrl) URL.revokeObjectURL(cachedPdfUrl);
          setCachedPdfUrl(URL.createObjectURL(file));
        }
        await load(documentId);
        setSourceRevision((value) => value + 1);
        setDocName(file.name);
        const variant = result.variant === "html" ? "html" : "pdf";
        setContentType(variant);
        setSourceMode("primary");
        setNotice(
          `PDF 原稿已寫入並重新讀回驗證成功；${questions.length} 題未重新拆解。`,
        );
        return;
      }
      setNotice("正在準備上傳原稿…");
      const initResponse = await fetch("/api/documents/multipart", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "init",
          fileName: file.name,
          contentType,
        }),
      });
      const init = (await initResponse.json().catch(() => ({}))) as {
        key?: string;
        uploadId?: string;
        error?: string;
      };
      if (!initResponse.ok || !init.key || !init.uploadId)
        throw new Error(init.error || "無法開始上傳");
      const chunkSize = 5 * 1024 * 1024,
        parts: Array<{ partNumber: number; etag: string }> = [];
      for (
        let start = 0, partNumber = 1;
        start < file.size;
        start += chunkSize, partNumber++
      ) {
        const progress = Math.min(99, Math.round((start / file.size) * 100));
        setNotice(`正在上傳原稿 ${progress}%…`);
        const response = await fetch(
          `/api/documents/multipart?key=${encodeURIComponent(init.key)}&uploadId=${encodeURIComponent(init.uploadId)}&partNumber=${partNumber}`,
          {
            method: "PUT",
            headers: { "content-type": "application/octet-stream" },
            body: file.slice(start, Math.min(start + chunkSize, file.size)),
          },
        );
        const part = (await response.json().catch(() => ({}))) as {
          partNumber?: number;
          etag?: string;
          error?: string;
        };
        if (!response.ok || !part.partNumber || !part.etag)
          throw new Error(part.error || `第 ${partNumber} 段上傳失敗`);
        parts.push({ partNumber: part.partNumber, etag: part.etag });
      }
      setNotice("上傳完成，正在保存原稿版本…");
      const completeResponse = await fetch("/api/documents/multipart", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "complete",
          key: init.key,
          uploadId: init.uploadId,
          parts,
          fileName: file.name,
          contentType,
          sizeBytes: file.size,
          examCategory: category,
          subject: current?.subject || docName,
          documentType: "題庫",
          replaceDocumentId: documentId,
          existingQuestionCount: questions.length,
        }),
      });
      const result = (await completeResponse.json().catch(() => ({}))) as {
        error?: string;
        variant?: string;
        name?: string;
      };
      if (!completeResponse.ok)
        throw new Error(result.error || "無法保存原稿版本");
      await load(documentId);
      setSourceRevision((value) => value + 1);
      if (result.name) setDocName(result.name);
      if (result.variant === "pdf" || result.variant === "html") {
        setContentType(result.variant);
        setSourceMode("primary");
        setSourceVariants((items) =>
          items.some((item) => item.kind === result.variant)
            ? items
            : [
                ...items,
                {
                  kind: result.variant as "pdf" | "html",
                  storageKey: init.key,
                  fileName: result.name || file.name,
                  contentType,
                },
              ],
        );
      }
      setNotice(
        `已保留原稿並新增 ${result.variant?.toUpperCase() || "文件"} 版本；題目未重新拆解。`,
      );
    } catch (error) {
      setNotice(
        error instanceof Error
          ? `原稿上傳失敗：${error.message}`
          : "原稿上傳失敗，請稍後再試",
      );
    } finally {
      if (replacementInput.current) replacementInput.current.value = "";
      setImporting(0);
    }
  }
  async function importAndOpen(id: number) {
    setImporting(id);
    setNotice("正在從原始文件重新拆解題目…");
    let offset = 0;
    for (let round = 0; round < 30; round += 1) {
      const response = await fetch(paths.import, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          documentId: id,
          offset,
          limit: 100,
          forceReparse: offset === 0,
        }),
      });
      const data = (await response.json()) as {
        done?: boolean;
        nextOffset?: number;
        error?: string;
      };
      if (!response.ok) {
        setNotice(data.error || "拆題失敗");
        setImporting(0);
        return;
      }
      offset = data.nextOffset ?? offset;
      if (data.done) break;
    }
    location.href = `${paths.workspace}?id=${id}`;
  }
  async function save() {
    if (!current) return;
    setSaving(true);
    const response = await fetch(paths.questions, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(current),
    });
    const data = (await response.json().catch(() => ({}))) as {
      item?: Partial<Question>;
      error?: string;
    };
    if (response.ok) {
      const next = {
        ...current,
        ...(data.item ?? {}),
        reviewStatus: data.item?.reviewStatus ?? "pending",
      } as Question;
      setQuestions((list) => list.map((x) => (x.id === next.id ? next : x)));
      setCurrent(next);
      const answerReady = /^[A-D]$/i.test(
        String(next.teacherAnswer || next.correctAnswer || "").trim(),
      );
      setNotice(
        next.status === "disabled" && current.status === "published"
          ? answerReady
            ? "本題內容已修改並下架；老師答案仍已確認，可免校對直接重新發布。"
            : "本題內容已修改，已自動下架並恢復待校對。"
          : answerReady
            ? "本題已儲存；老師答案已確認，可免校對直接發布。"
            : "本題已儲存；沒有老師答案時才需要重新校對才能發布。",
      );
    } else setNotice(data.error || "儲存失敗");
    setSaving(false);
  }
  async function applySpacingRepair() {
    if (!current) return;
    const clean = (value: string | undefined) =>
      removeSuspiciousSpacing(value || "");
    const repaired = {
      ...current,
      stem: clean(current.stem),
      options: Object.fromEntries(
        Object.entries(current.options ?? {}).map(([key, value]) => [
          key,
          clean(value),
        ]),
      ),
      explanation: clean(current.explanation),
      teacherAnswer: clean(current.teacherAnswer),
      aiCompleteExplanation: clean(current.aiCompleteExplanation),
      teacherCompleteExplanation: clean(current.teacherCompleteExplanation),
      completeExplanation: clean(current.completeExplanation),
    } as Question;
    setSaving(true);
    const response = await fetch(paths.questions, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(repaired),
    });
    const data = (await response.json().catch(() => ({}))) as {
      item?: Partial<Question>;
      error?: string;
    };
    if (response.ok) {
      const saved = { ...repaired, ...(data.item ?? {}) } as Question;
      setCurrent(saved);
      setQuestions((list) =>
        list.map((item) => (item.id === saved.id ? saved : item)),
      );
      setRichEditorOpen(false);
      setNotice("已自動移除本題異常空格並儲存；請在純文字檢視核對結果。");
    } else setNotice(data.error || "自動移除空格失敗");
    setSaving(false);
  }
  async function dismissQualityWarning(warning: DismissibleQualityFilter) {
    if (!current || !accounting) return;
    const sourceHasNoAnswer = warning === "missing-answer";
    if (
      !window.confirm(
        sourceHasNoAnswer
          ? "已核對左側原稿，確定原書本題沒有附答案嗎？註記後將不再列入缺答案。"
          : "已核對左側原稿，確定本題內容正確並解除這一項警示嗎？",
      )
    )
      return;
    setSaving(true);
    const response = await fetch(paths.questions, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: current.id, dismissQualityWarning: warning }),
    });
    const data = (await response.json().catch(() => ({}))) as {
      item?: Question;
      error?: string;
    };
    if (response.ok && data.item) {
      const saved = data.item;
      setCurrent(saved);
      setQuestions((list) =>
        list.map((item) => (item.id === saved.id ? saved : item)),
      );
      setNotice(
        sourceHasNoAnswer
          ? "已註記「原書未附答案」；本題不再列入缺答案，其他品質警示不受影響。"
          : "已記錄老師確認：這一項是 AI 誤判；其他品質警示不受影響。",
      );
    } else setNotice(data.error || "解除警示失敗");
    setSaving(false);
  }
  async function batchRepairCurrentFilter() {
    if (qualityFilter !== "spacing" && qualityFilter !== "linebreak") return;
    const count = qualityCounts[qualityFilter];
    if (!count) return;
    const label = qualityFilter === "spacing" ? "異常空格" : "疑似斷行";
    const warning =
      qualityFilter === "linebreak"
        ? "這會合併中文字之間的換行，請先抽查幾題確認規則正確。"
        : "這會移除中文字間可明確判定的多餘空格。";
    if (
      !confirm(
        `確定批次修復本文件 ${count} 題「${label}」？\n\n${warning}\n不會呼叫 AI，也不會修改亂碼、答案或題型。`,
      )
    )
      return;
    setBatchRepairing(true);
    setNotice(`正在批次修復 ${count} 題「${label}」…`);
    const response = await fetch(paths.questions, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ documentId, qualityRepair: qualityFilter }),
    });
    const data = (await response.json().catch(() => ({}))) as {
      updated?: number;
      error?: string;
    };
    if (response.ok) {
      await load(documentId);
      setQualityFilter(qualityFilter);
      setNotice(
        `批次修復完成：已更新 ${data.updated ?? 0} 題「${label}」，並重新掃描統計。`,
      );
    } else setNotice(data.error || "批次修復失敗");
    setBatchRepairing(false);
  }
  function aiUsageText(usage?: {
    inputTokens?: number;
    outputTokens?: number;
    estimatedCostUsd?: number;
  }) {
    return usage
      ? `｜本次輸入 ${(usage.inputTokens ?? 0).toLocaleString()}、輸出 ${(usage.outputTokens ?? 0).toLocaleString()} tokens，估算 US$ ${(usage.estimatedCostUsd ?? 0).toFixed(6)}；已累積至總管理編輯成本。`
      : "";
  }
  async function updateReview(action: "confirmReview" | "cancelReview") {
    if (!current || accounting) return;
    if (
      action === "confirmReview" &&
      !window.confirm(
        `確定第 ${current.questionNumber || current.id} 題的答案與解析都已經校對完成嗎？`,
      )
    )
      return;
    const response = await fetch(paths.questions, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: current.id, [action]: true }),
    });
    const data = (await response.json().catch(() => ({}))) as {
      item?: Partial<Question>;
      error?: string;
      unpublished?: boolean;
    };
    if (!response.ok) {
      setNotice(data.error || "校對狀態更新失敗");
      return;
    }
    const next = {
      ...current,
      ...(data.item ?? {}),
      reviewStatus: action === "confirmReview" ? "confirmed" : "pending",
    } as Question;
    setCurrent(next);
    setQuestions((list) =>
      list.map((item) => (item.id === next.id ? next : item)),
    );
    setNotice(
      action === "confirmReview"
        ? "本題已確認校對完成；現在可以發布。"
        : data.unpublished
          ? "本題已取消校對並下架；重新校對後才能發布。"
          : "本題已取消校對，需重新確認後才能發布。",
    );
  }
  function confirm(message: string) {
    let detail = message;
    if (
      message.includes("缺少 AI 擬答或解析") ||
      message.includes("缺少 AI 完整解析")
    ) {
      const targets = message.includes("缺少 AI 擬答或解析")
        ? questions.filter(
            (question) =>
              question.isSimulation &&
              (!question.simulatedAnswer ||
                !question.simulatedExplanation ||
                !(
                  question.simulatedCompleteExplanation ||
                  question.aiCompleteExplanation
                )),
          )
        : questions.filter(
            (question) =>
              !question.isSimulation &&
              !question.aiCompleteExplanation?.trim() &&
              Boolean(question.teacherAnswer || question.correctAnswer),
          );
      const labels = targets.map(
        (question) => `第 ${question.questionNumber || question.id} 題`,
      );
      if (labels.length)
        detail += `\n\n即將處理：${labels.length > 30 ? `${labels.slice(0, 30).join("、")}…（共 ${labels.length} 題）` : labels.join("、")}`;
      detail += "\n\n確認後會逐題處理，進度列會顯示目前題號。";
    }
    return window.confirm(detail);
  }
  async function generateAiSimulation() {
    if (!current || accounting || !current.isSimulation) return;
    const optionsReady = ["A", "B", "C", "D"].every((letter) =>
      String(current.options?.[letter] ?? "").trim(),
    );
    if (!current.stem.trim() || !optionsReady) {
      setNotice("請先確認題幹與 A～D 選項都已填寫，再產生 AI 擬答。");
      return;
    }
    setAiGenerating(true);
    setNotice("AI 正在依題幹與 A～D 選項產生擬答與完整解析…");
    try {
      const response = await fetch("/api/medtech/admin/questions/simulation", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: current.id, force: true }),
      });
      const data = (await response.json()) as {
        item?: Partial<Question> & { optionsJson?: string };
        error?: string;
      };
      if (!response.ok || !data.item) {
        setNotice(data.error || "AI 擬答產生失敗，請稍後再試。");
        return;
      }
      const returned = data.item;
      let options = current.options;
      if (returned.options && typeof returned.options === "object")
        options = returned.options;
      else if (returned.optionsJson) {
        try {
          options = JSON.parse(returned.optionsJson) as Record<string, string>;
        } catch {
          /* keep current options */
        }
      }
      const { optionsJson: _optionsJson, ...generated } = returned;
      const next = {
        ...current,
        ...generated,
        options,
        isSimulation: true,
      } as Question;
      setCurrent(next);
      setQuestions((list) =>
        list.map((item) => (item.id === next.id ? next : item)),
      );
      setNotice("AI 擬答與 AI 完整解析已產生，請老師核對後再填入老師版。");
    } catch {
      setNotice("AI 擬答請求失敗，請稍後再試。");
    } finally {
      setAiGenerating(false);
    }
  }
  async function generateAiExplanation() {
    if (!current || accounting) return;
    const optionsReady = ["A", "B", "C", "D"].every((letter) =>
      String(current.options?.[letter] ?? "").trim(),
    );
    if (!current.stem.trim() || !optionsReady) {
      setNotice("請先確認題幹與 A～D 選項都已填寫，再產生 AI 完整解析。");
      return;
    }
    if (
      current.aiCompleteExplanation?.trim() &&
      !confirm("本題已有 AI 完整解析，確定要重新產生嗎？")
    )
      return;
    setAiGenerating(true);
    setNotice("AI 正在產生本題完整解析…");
    try {
      const response = await fetch("/api/medtech/admin/questions/explanation", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: current.id, force: true, mode: "ai" }),
      });
      const data = (await response.json()) as {
        item?: Partial<Question>;
        error?: string;
      };
      if (!response.ok || !data.item) {
        setNotice(data.error || "AI 完整解析產生失敗，請稍後再試。");
        return;
      }
      const next = { ...current, ...data.item } as Question;
      setCurrent(next);
      setQuestions((list) =>
        list.map((item) => (item.id === next.id ? next : item)),
      );
      setNotice("AI 完整解析已寫入 AI 版；完成後可直接作為語音解析文字。");
    } catch {
      setNotice("AI 完整解析請求失敗，請稍後再試。");
    } finally {
      setAiGenerating(false);
    }
  }
  async function generateAiExplanationBatch() {
    const targets = questions.filter(
      (question) =>
        !question.isSimulation &&
        !question.aiCompleteExplanation?.trim() &&
        Boolean(question.teacherAnswer || question.correctAnswer),
    );
    if (!targets.length) {
      setNotice("本文件正式題都已有 AI 完整解析，或尚未設定答案。");
      return;
    }
    if (
      !confirm(
        "本文件有 " +
          targets.length +
          " 題缺少 AI 完整解析，將在文件內逐題產生。確定開始？",
      )
    )
      return;
    setAiGenerating(true);
    let success = 0;
    let failed = 0;
    for (const question of targets) {
      setNotice(
        "正在批次產生 AI 完整解析：" +
          (success + failed + 1) +
          "/" +
          targets.length +
          "（第 " +
          (question.questionNumber || question.id) +
          " 題）",
      );
      try {
        const response = await fetch(
          "/api/medtech/admin/questions/explanation",
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ id: question.id, force: true, mode: "ai" }),
          },
        );
        const data = (await response.json()) as {
          item?: Partial<Question>;
          error?: string;
        };
        if (!response.ok || !data.item)
          throw new Error(data.error || "產生失敗");
        const next = { ...question, ...data.item } as Question;
        setQuestions((list) =>
          list.map((item) => (item.id === next.id ? next : item)),
        );
        setCurrent((item) => (item?.id === next.id ? next : item));
        success += 1;
      } catch {
        failed += 1;
      }
    }
    setAiGenerating(false);
    setNotice(
      "AI 完整解析批次完成：成功 " +
        success +
        " 題" +
        (failed ? "，失敗 " + failed + " 題" : "") +
        "。內容已寫入 AI 版。",
    );
  }
  async function generateAiBatch() {
    const targets = questions.filter(
      (question) =>
        question.isSimulation &&
        (!question.simulatedAnswer ||
          !question.simulatedExplanation ||
          !(
            question.simulatedCompleteExplanation ||
            question.aiCompleteExplanation
          )),
    );
    if (!targets.length) {
      setNotice("本文件的全真模擬題都已有 AI 擬答與解析。");
      return;
    }
    if (
      !confirm(
        `本文件有 ${targets.length} 題缺少 AI 擬答或解析，將逐題產生並計入模型使用量。確定開始？`,
      )
    )
      return;
    setAiGenerating(true);
    let success = 0;
    let failed = 0;
    for (const question of targets) {
      setNotice(
        `正在批次產生 AI 擬答與解析：${success + failed + 1}/${targets.length}（第 ${question.questionNumber || question.id} 題）`,
      );
      try {
        const response = await fetch(
          "/api/medtech/admin/questions/simulation",
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ id: question.id, force: true }),
          },
        );
        const data = (await response.json()) as {
          item?: Partial<Question>;
          error?: string;
        };
        if (!response.ok || !data.item)
          throw new Error(data.error || "產生失敗");
        const next = {
          ...question,
          ...data.item,
          options: question.options,
          isSimulation: true,
        } as Question;
        setQuestions((list) =>
          list.map((item) => (item.id === next.id ? next : item)),
        );
        setCurrent((item) => (item?.id === next.id ? next : item));
        success += 1;
      } catch {
        failed += 1;
      }
    }
    setAiGenerating(false);
    setNotice(
      `批次完成：成功 ${success} 題${failed ? `，失敗 ${failed} 題` : ""}。AI 解析已分開寫入，老師版仍待核對。`,
    );
  }
  function downloadCurrentTxt() {
    if (!current) return;
    downloadFile(
      questionText(current, !accounting),
      safeQuestionFileName(
        current,
        questions.findIndex((item) => item.id === current.id),
      ),
      "text/plain;charset=utf-8",
    );
    setNotice(
      `已下載第 ${current.questionNumber || "本題"} 題 TXT（${accounting ? "解析" : "完整解析語音文字"}）。`,
    );
  }
  function downloadAllTxtZip() {
    if (!questions.length) return;
    const entries: Record<string, Uint8Array> = {};
    const folder = "完整解析TXT/";
    entries["README.txt"] = strToU8(
      accounting
        ? "本 ZIP 由中會後台匯出。每個 TXT 對應一題。\n"
        : "本 ZIP 由醫檢備考後台匯出。每個 TXT 只包含該題的『完整解析文字』（老師版優先）正文，不包含題幹、選項、答案或其他解析欄位。\n檔名格式：排序_q題目ID_第題號題.txt。匯入 MP3／M4A 時，沿用同一檔名只更換副檔名即可自動配對；系統會以 q題目ID 驗證，檔名不符會列為未配對。\n",
    );
    questions.forEach((question, index) => {
      entries[`${folder}${safeQuestionFileName(question, index)}`] = strToU8(
        questionText(question, !accounting),
      );
    });
    const zipped = zipSync(entries, { level: 6 });
    const base =
      docName
        .replace(/\.[^.]+$/, " ")
        .trim()
        .replace(/\s+/g, "-") || "醫檢題庫";
    downloadFile(zipped, `${base}-完整解析TXT.zip`, "application/zip");
    setNotice(
      `已打包 ${questions.length} 題語音解析 TXT；尚未有完整解析的題目會輸出空白 TXT。`,
    );
  }
  async function replaceAllQuestions() {
    const find = questionSearch;
    const replacement = replaceText;
    if (!find) {
      setNotice("請先在搜尋框輸入要尋找的文字");
      return;
    }
    const targets = questions.filter((question) =>
      searchableQuestionText(question).includes(find.toLocaleLowerCase()),
    );
    if (!targets.length) {
      setNotice(`找不到「${find}」`);
      return;
    }
    if (
      !confirm(
        `已找到 ${targets.length} 題，確定將題幹、選項、簡要解析與完整解析中的「${find}」全部取代為「${replacement}」嗎？`,
      )
    )
      return;
    setReplaceBusy(true);
    setNotice(`正在取代 ${targets.length} 題…`);
    const response = await fetch(paths.questions, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        documentId,
        replaceFind: find,
        replaceWith: replacement,
      }),
    });
    const result = (await response.json()) as {
      error?: string;
      updated?: number;
    };
    if (!response.ok) {
      setNotice(result.error || "全部取代失敗");
      setReplaceBusy(false);
      return;
    }
    const replace = (value: string) => value.split(find).join(replacement);
    const updateQuestion = (question: Question): Question => ({
      ...question,
      stem: replace(question.stem),
      explanation: replace(question.explanation),
      aiCompleteExplanation:
        question.aiCompleteExplanation === undefined
          ? question.aiCompleteExplanation
          : replace(question.aiCompleteExplanation),
      teacherCompleteExplanation:
        question.teacherCompleteExplanation === undefined
          ? question.teacherCompleteExplanation
          : replace(question.teacherCompleteExplanation),
      completeExplanation:
        question.completeExplanation === undefined
          ? question.completeExplanation
          : replace(question.completeExplanation),
      simulatedExplanation:
        question.simulatedExplanation === undefined
          ? question.simulatedExplanation
          : replace(question.simulatedExplanation),
      simulatedCompleteExplanation:
        question.simulatedCompleteExplanation === undefined
          ? question.simulatedCompleteExplanation
          : replace(question.simulatedCompleteExplanation),
      options: Object.fromEntries(
        Object.entries(question.options ?? {}).map(([key, value]) => [
          key,
          replace(String(value ?? "")),
        ]),
      ),
    });
    setQuestions((list) => list.map(updateQuestion));
    setCurrent((currentQuestion) =>
      currentQuestion ? updateQuestion(currentQuestion) : currentQuestion,
    );
    setNotice(`已完成全部取代：${result.updated ?? targets.length} 題`);
    setReplaceBusy(false);
  }
  const selectedKind = sourceMode === "primary" ? contentType : sourceMode;
  const isWord = /\.docx$/i.test(docName);
  const hasPdf =
    selectedKind === "pdf" ||
    /\.pdf$/i.test(docName) ||
    sourceVariants.some((item) => item.kind === "pdf");
  const hasStoredHtml =
    /\.html?$/i.test(docName) ||
    sourceVariants.some((item) => item.kind === "html");
  const hasHtml = hasStoredHtml || hasPdf || isWord;
  const sourceUrlBase =
    selectedKind === "html"
      ? `${paths.html}?id=${documentId}`
      : `${paths.source}?id=${documentId}${sourceMode === "primary" ? "" : `&variant=${sourceMode}`}`;
  const remoteSourceUrl = `${sourceUrlBase}${sourceUrlBase.includes("?") ? "&" : "?"}v=${sourceRevision}`;
  const sourceUrl =
    selectedKind === "pdf" && cachedPdfUrl ? cachedPdfUrl : remoteSourceUrl;
  function selectSource(kind: "pdf" | "html") {
    if (kind === "html" && !htmlAttempted) {
      setHtmlAttempted(true);
      setHtmlLoading(true);
      setNotice("正在建立 Word HTML 對照稿…");
      void fetch(`${paths.html}?id=${documentId}`, { cache: "no-store" })
        .then(async (response) => {
          if (!response.ok)
            throw new Error((await response.text()) || "HTML 對照建立失敗");
          setSourceRevision((value) => value + 1);
          setSourceMode("html");
          setNotice("HTML 對照稿已建立並保存。");
        })
        .catch((error) =>
          setNotice(
            error instanceof Error ? error.message : "HTML 對照建立失敗",
          ),
        )
        .finally(() => setHtmlLoading(false));
      return;
    }
    setSourceMode(kind === contentType ? "primary" : kind);
  }
  useEffect(() => {
    if (selectedKind !== "pdf" || !documentId) {
      setPdfPreviewUrl("");
      setSourceError("");
      return;
    }
    let disposed = false,
      objectUrl = "";
    setHtmlLoading(true);
    setSourceError("");
    setPdfPreviewUrl("");
    void fetch(sourceUrl, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok)
          throw new Error(
            (await response.text().catch(() => "")) ||
              `PDF 讀取失敗（${response.status}）`,
          );
        const blob = await response.blob();
        if (!blob.size) throw new Error("PDF 檔案內容是空的");
        objectUrl = URL.createObjectURL(blob);
        if (!disposed) setPdfPreviewUrl(objectUrl);
      })
      .catch((error) => {
        if (!disposed)
          setSourceError(
            error instanceof Error ? error.message : "PDF 預覽載入失敗",
          );
      })
      .finally(() => {
        if (!disposed) setHtmlLoading(false);
      });
    return () => {
      disposed = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [selectedKind, documentId, sourceUrl]);
  async function selectQuestion(question: Question) {
    setRichEditorOpen(false);
    setCurrent(question);
    try {
      const previous = JSON.parse(
        localStorage.getItem(workspacePositionKey(documentId)) || "{}",
      ) as WorkspacePosition;
      localStorage.setItem(
        workspacePositionKey(documentId),
        JSON.stringify({
          ...previous,
          questionId: question.id,
          richEditorOpen: false,
        }),
      );
    } catch {}
  }
  useEffect(() => {
    if (!documentId || loading) return;
    try {
      localStorage.setItem(
        workspacePositionKey(documentId),
        JSON.stringify({
          questionId: current?.id,
          pdfPage,
          questionSearch,
          qualityFilter,
          richEditorOpen,
        } satisfies WorkspacePosition),
      );
    } catch {}
  }, [
    documentId,
    current?.id,
    pdfPage,
    questionSearch,
    qualityFilter,
    richEditorOpen,
    loading,
  ]);
  const normalizedQuestionSearch = questionSearch.trim().toLocaleLowerCase();
  const answerConflictQuestions = questions.filter(
    (question) =>
      /^[A-D]$/.test(
        String(question.teacherAnswer || question.correctAnswer || "")
          .trim()
          .toUpperCase(),
      ) &&
      /^[A-D]$/.test(
        String(question.simulatedAnswer || "")
          .trim()
          .toUpperCase(),
      ) &&
      String(question.teacherAnswer || question.correctAnswer || "")
        .trim()
        .toUpperCase() !==
        String(question.simulatedAnswer || "")
          .trim()
          .toUpperCase(),
  );
  const qualityCounts = questions.reduce(
    (counts, question) => {
      const flags = qualityFlags(question);
      for (const key of Object.keys(flags) as Exclude<QualityFilter, "all">[])
        if (flags[key]) counts[key] += 1;
      return counts;
    },
    {
      "missing-answer": 0,
      "missing-options": 0,
      "option-contamination": 0,
      garbled: 0,
      spacing: 0,
      linebreak: 0,
      type: 0,
    },
  );
  const qualityFiltered =
    qualityMode && qualityFilter !== "all"
      ? questions.filter((question) => qualityFlags(question)[qualityFilter])
      : questions;
  const visibleQuestions = answerDiffOnly
    ? answerConflictQuestions
    : normalizedQuestionSearch
      ? qualityFiltered.filter((question) =>
          searchableQuestionText(question).includes(normalizedQuestionSearch),
        )
      : qualityFiltered;
  function openNextVisibleQuestion() {
    if (!current || !visibleQuestions.length) return;
    const index = visibleQuestions.findIndex(
      (question) => question.id === current.id,
    );
    const next =
      visibleQuestions[
        index >= 0 && index + 1 < visibleQuestions.length ? index + 1 : 0
      ];
    if (next.id === current.id) {
      setNotice("目前篩選結果只有這一題。");
      return;
    }
    void selectQuestion(next);
  }
  useEffect(() => {
    const handleArrowNavigation = (event: KeyboardEvent) => {
      if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable)
      )
        return;
      if (!current) return;
      const search = questionSearch.trim().toLocaleLowerCase();
      const list = search
        ? questions.filter((question) =>
            searchableQuestionText(question).includes(search),
          )
        : questions;
      const index = list.findIndex((question) => question.id === current.id);
      const nextIndex = event.key === "ArrowUp" ? index - 1 : index + 1;
      if (index < 0 || nextIndex < 0 || nextIndex >= list.length) return;
      event.preventDefault();
      const next = list[nextIndex];
      setCurrent(next);
      window.setTimeout(() => {
        const buttons = document.querySelectorAll<HTMLButtonElement>(
          ".document-question-list>button",
        );
        buttons[nextIndex]?.scrollIntoView({ block: "nearest" });
      }, 0);
    };
    window.addEventListener("keydown", handleArrowNavigation);
    return () => window.removeEventListener("keydown", handleArrowNavigation);
  }, [current?.id, questions, questionSearch]);
  const pendingAiQuestions = questions.filter(
    (question) =>
      question.isSimulation &&
      (!question.simulatedAnswer ||
        !question.simulatedExplanation ||
        !(
          question.simulatedCompleteExplanation ||
          question.aiCompleteExplanation
        )),
  );
  const pendingAiExplanationQuestions = questions.filter(
    (question) =>
      !question.isSimulation &&
      !question.aiCompleteExplanation?.trim() &&
      Boolean(question.teacherAnswer || question.correctAnswer),
  );
  const accountingLongTeacherAnswer = Boolean(
    accounting &&
    current &&
    richTextToPlain(current.teacherAnswer || "") &&
    !/^[A-D]$/i.test(richTextToPlain(current.teacherAnswer || "")),
  );
  if (loading)
    return (
      <main className="document-workspace-state">正在開啟文件拆題工作區…</main>
    );
  if (!documentId)
    return (
      <main className="workspace-library">
        <header>
          <div>
            <a href={paths.back}>← 返回文件後台</a>
            <h1>文件拆題工作區</h1>
            <p>選擇一份原始文件，拆題後直接左右對照編輯。</p>
          </div>
        </header>
        {notice && <p className="workspace-notice">{notice}</p>}
        <section>
          {docs.map((doc) => (
            <article key={doc.id}>
              <div>
                <span>
                  {doc.subject} · {doc.type}
                </span>
                <h2>{doc.name}</h2>
                <small>
                  {doc.processingStage === "completed"
                    ? "文件已處理"
                    : "文件處理中"}{" "}
                  · 現有 {doc.questionCount} 題
                </small>
              </div>
              <button
                disabled={
                  Boolean(importing) || doc.processingStage !== "completed"
                }
                onClick={() => void importAndOpen(doc.id)}
              >
                {importing === doc.id
                  ? "拆題中…"
                  : doc.questionCount
                    ? "重新拆題並開啟"
                    : "拆題並開啟"}
              </button>
            </article>
          ))}
          {!docs.length && (
            <p className="empty-editor">尚未上傳醫檢文件，請先回後台上傳。</p>
          )}
        </section>
      </main>
    );
  return (
    <main className="document-workspace">
      <header>
        <div>
          <a href={paths.back}>← 返回文件題庫</a>
          <h1>{qualityMode ? "題庫品質修復中心" : "文件拆題工作區"}</h1>
          <p>
            {qualityMode
              ? `${docName} · PDF 找題、異常篩選與富文修復集中在同一工作區`
              : `${docName} · ${questions.length} 題`}
          </p>
        </div>
        <div className="workspace-header-actions">
          <span>{notice}</span>
          <button
            type="button"
            onClick={() => {
              const params = new URLSearchParams(location.search);
              if (qualityMode) params.delete("quality");
              else params.set("quality", "1");
              history.replaceState(
                null,
                "",
                `${location.pathname}?${params.toString()}`,
              );
              setQualityMode(!qualityMode);
              setQualityFilter("all");
            }}
          >
            {qualityMode ? "返回完整題庫" : "品質修復"}
          </button>
          {!qualityMode && (
            <button disabled={Boolean(importing)} onClick={rebuildQuestions}>
              {importing
                ? "處理中…"
                : questions.length
                  ? "重新完整拆題"
                  : "開始拆題"}
            </button>
          )}
          {!accounting && (
            <ManualQuestionDialog
              documentId={documentId}
              subject={current?.subject || docName}
              disabled={Boolean(importing)}
              onCreated={async () => {
                await load(documentId);
                setNotice("已手動新增題目並加入目前文件。");
              }}
            />
          )}
          {!accounting && (
            <RepairMissingQuestionsButton
              documentId={documentId}
              disabled={Boolean(importing)}
              onDone={async (message) => {
                await load(documentId);
                setNotice(message);
              }}
            />
          )}
          <button
            type="button"
            className="ai-batch-button"
            disabled={aiGenerating || !pendingAiQuestions.length}
            onClick={() => void generateAiBatch()}
          >
            {aiGenerating
              ? "AI 批次產生中…"
              : pendingAiQuestions.length
                ? `AI補齊本文件 ${pendingAiQuestions.length} 題`
                : "本文件 AI 擬答已完成"}
          </button>
          <button
            type="button"
            className="ai-batch-button"
            disabled={aiGenerating || !pendingAiExplanationQuestions.length}
            onClick={() => void generateAiExplanationBatch()}
          >
            {aiGenerating
              ? "AI 批次產生中…"
              : pendingAiExplanationQuestions.length
                ? "AI補齊本文件完整解析 " +
                  pendingAiExplanationQuestions.length +
                  " 題"
                : "本文件 AI 完整解析已完成"}
          </button>
          <button disabled={!current || saving} onClick={() => void save()}>
            {saving ? "儲存中…" : "儲存本題"}
          </button>
          <button
            type="button"
            disabled={!current || saving || visibleQuestions.length < 2}
            onClick={openNextVisibleQuestion}
          >
            下一題
          </button>
          <button disabled={!current} onClick={downloadCurrentTxt}>
            下載本題 TXT
          </button>
          <button disabled={!questions.length} onClick={downloadAllTxtZip}>
            語音解析腳本 TXT ZIP
          </button>
        </div>
      </header>
      <section className="document-workspace-body">
        <aside className="original-document">
          <header>
            <b>
              原始文件{" "}
              {htmlLoading ? (
                <small>· HTML 轉換中…</small>
              ) : (
                selectedKind === "pdf" && (
                  <small>· {locating ? "定位中…" : `第 ${pdfPage} 頁`}</small>
                )
              )}
            </b>
            <span className="original-document-tools">
              <nav className="source-tabs" aria-label="原稿版本切換">
                {hasPdf && (
                  <button
                    type="button"
                    className={selectedKind === "pdf" ? "active" : ""}
                    onClick={() => selectSource("pdf")}
                  >
                    PDF 原稿
                  </button>
                )}
                {hasHtml && (
                  <button
                    type="button"
                    className={selectedKind === "html" ? "active" : ""}
                    onClick={() => selectSource("html")}
                  >
                    {hasStoredHtml
                      ? "HTML 對照"
                      : isWord
                        ? "HTML 對照（Word 轉換）"
                        : "HTML 對照（PDF 轉換）"}
                  </button>
                )}
              </nav>
              <button
                disabled={Boolean(importing)}
                onClick={() => replacementInput.current?.click()}
              >
                新增／更換原稿
              </button>
              <input
                ref={replacementInput}
                hidden
                type="file"
                accept=".pdf,.html,.htm,.docx"
                onChange={(event) => {
                  const next = event.target.files?.[0];
                  if (next) void replaceSource(next);
                }}
              />
              <a href={sourceUrl} target="_blank">
                另開原稿
              </a>
            </span>
          </header>
          {selectedKind === "pdf" || selectedKind === "html" ? (
            <iframe
              key={`${selectedKind}-${pdfPage}`}
              src={`${sourceUrl}${selectedKind === "pdf" ? `#page=${pdfPage}&zoom=page-width` : ""}`}
              onLoad={() => setHtmlLoading(false)}
              title={docName}
            />
          ) : (
            <div className="word-original">
              <b>Word 原始檔已保留</b>
              <p>
                Word
                在瀏覽器內無法百分之百保留原始分頁、浮動圖片與表格位置。請按「另開原稿」下載查看；若需要逐頁精準對照，建議同時上傳
                PDF 或 HTML。
              </p>
              <a href={sourceUrl}>下載原始 Word</a>
            </div>
          )}
        </aside>
        <aside className="document-question-list">
          <header>
            <b>拆出題目</b>
            <span>
              {normalizedQuestionSearch
                ? `${visibleQuestions.length} / ${questions.length} 題`
                : `${questions.length} 題`}
            </span>
          </header>
          {qualityMode && (
            <div className="quality-repair-filters">
              <b>疑似問題</b>
              {(
                [
                  ["all", "全部", questions.length],
                  ["missing-answer", "缺答案", qualityCounts["missing-answer"]],
                  [
                    "missing-options",
                    "選項不完整",
                    qualityCounts["missing-options"],
                  ],
                  [
                    "option-contamination",
                    "解析混入選項",
                    qualityCounts["option-contamination"],
                  ],
                  ["garbled", "亂碼／異常字元", qualityCounts.garbled],
                  ["spacing", "異常空格", qualityCounts.spacing],
                  ["linebreak", "疑似斷行", qualityCounts.linebreak],
                  ["type", "題型疑似誤判", qualityCounts.type],
                ] as [QualityFilter, string, number][]
              ).map(([key, label, count]) => (
                <button
                  type="button"
                  key={key}
                  className={qualityFilter === key ? "active" : ""}
                  onClick={() => {
                    setQualityFilter(key);
                    const next =
                      key === "all"
                        ? questions[0]
                        : questions.find(
                            (question) => qualityFlags(question)[key],
                          );
                    if (next && next.id !== current?.id)
                      void selectQuestion(next);
                  }}
                >
                  {label}
                  <span>{count}</span>
                </button>
              ))}
              {(qualityFilter === "spacing" ||
                qualityFilter === "linebreak") && (
                <button
                  type="button"
                  className="quality-batch-repair"
                  disabled={
                    batchRepairing || qualityCounts[qualityFilter] === 0
                  }
                  onClick={() => void batchRepairCurrentFilter()}
                >
                  {batchRepairing
                    ? "整批修復中…"
                    : `一鍵修復此分類（${qualityCounts[qualityFilter]} 題）`}
                </button>
              )}
            </div>
          )}
          <input
            className="question-list-search"
            value={questionSearch}
            onChange={(event) => setQuestionSearch(event.target.value)}
            placeholder="搜尋題號、題幹、選項或解析"
            aria-label="搜尋題庫"
          />
          <div className="question-replace-tools">
            <input
              value={replaceText}
              onChange={(event) => setReplaceText(event.target.value)}
              placeholder="取代文字（可留空）"
              aria-label="取代文字"
            />
            <button
              type="button"
              disabled={replaceBusy || !questionSearch}
              onClick={() => void replaceAllQuestions()}
            >
              {replaceBusy ? "取代中…" : "全部取代"}
            </button>
          </div>
          {visibleQuestions.map((q, index) => (
            <button
              className={current?.id === q.id ? "active" : ""}
              key={q.id}
              onClick={() => void selectQuestion(q)}
            >
              <b>{index + 1}</b>
              <span>
                第 {q.questionNumber} 題
                <small>
                  {q.year} · {q.subject}
                </small>
              </span>
            </button>
          ))}
          {!visibleQuestions.length && (
            <div className="empty-questions">
              {normalizedQuestionSearch
                ? "找不到符合關鍵字的題目。"
                : importing
                  ? "正在辨識題目、選項與答案…"
                  : "尚未拆出題目；左側原稿仍可正常查看。"}
            </div>
          )}
        </aside>
        <article className="document-question-editor">
          {current ? (
            <>
              {qualityMode && (
                <div className="workspace-quality-actions">
                  <div className="workspace-quality-reasons">
                    <b>本題品質檢查</b>
                    {qualityReasons(current).map((reason, index) => (
                      <p
                        className={reason.level.toLocaleLowerCase()}
                        key={`${reason.text}-${index}`}
                      >
                        <strong>{reason.level}</strong>
                        <span>{reason.text}</span>
                        {accounting &&
                          dismissibleQualityWarnings.has(
                            reason.key as DismissibleQualityFilter,
                          ) && (
                            <button
                              type="button"
                              className="quality-dismiss-button"
                              disabled={saving}
                              onClick={() =>
                                void dismissQualityWarning(
                                  reason.key as DismissibleQualityFilter,
                                )
                              }
                            >
                              {reason.key === "missing-answer"
                                ? "原書未附答案"
                                : "此題正確，解除此警示"}
                            </button>
                          )}
                      </p>
                    ))}
                  </div>
                  {qualityFlags(current).spacing && (
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => void applySpacingRepair()}
                    >
                      自動移除異常空格
                    </button>
                  )}
                  {qualityFlags(current).linebreak && (
                    <button
                      type="button"
                      onClick={() => {
                        setCurrent({
                          ...current,
                          stem: removeSuspiciousLineBreaks(current.stem),
                          options: Object.fromEntries(
                            Object.entries(current.options ?? {}).map(
                              ([key, value]) => [
                                key,
                                removeSuspiciousLineBreaks(value),
                              ],
                            ),
                          ),
                          explanation: removeSuspiciousLineBreaks(
                            current.explanation,
                          ),
                        });
                        setRichEditorOpen(true);
                        setNotice("已合併疑似斷行；請核對 PDF 後儲存。");
                      }}
                    >
                      自動合併斷行
                    </button>
                  )}
                  {qualityFlags(current).type &&
                    !Object.values(current.options ?? {}).some((value) =>
                      richTextToPlain(value),
                    ) && (
                      <>
                        <span>
                          系統建議：
                          {suggestedExamType(current) === "essay"
                            ? "申論題"
                            : suggestedExamType(current) === "calculation"
                              ? "計算題"
                              : "簡答題"}
                          ，請確認：
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            setCurrent({
                              ...current,
                              examType: "short_answer",
                            });
                            setRichEditorOpen(true);
                            setNotice("已標示為簡答題；請核對內容後儲存。");
                          }}
                        >
                          標為簡答題
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setCurrent({ ...current, examType: "calculation" });
                            setRichEditorOpen(true);
                            setNotice("已標示為計算題；請核對內容後儲存。");
                          }}
                        >
                          標為計算題
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setCurrent({ ...current, examType: "essay" });
                            setRichEditorOpen(true);
                            setNotice("已標示為申論題；請核對內容後儲存。");
                          }}
                        >
                          標為申論題
                        </button>
                      </>
                    )}
                  {!Object.values(qualityFlags(current)).some(Boolean) && (
                    <span>
                      {qualityFilter === "all"
                        ? "本題未偵測到結構異常"
                        : `本題未命中目前篩選；此分類共有 ${qualityCounts[qualityFilter]} 題，請從左側結果選題。`}
                    </span>
                  )}
                </div>
              )}
              {!richEditorOpen && (
                <QuestionProofreadDialog
                  question={current}
                  accounting={accounting}
                  onClose={() => setRichEditorOpen(true)}
                />
              )}{" "}
              {richEditorOpen && (
                <>
                  <div className="document-question-mode-bar">
                    <div>
                      <b>富文編輯模式</b>
                      <small>可直接編輯題幹、A～D 選項與解析內容。</small>
                    </div>
                    <button
                      type="button"
                      onClick={() => setRichEditorOpen(false)}
                    >
                      關閉富文編輯
                    </button>
                  </div>
                  <div className="question-editor-meta">
                    <label>
                      考試來源／年份
                      <input
                        value={current.year}
                        onChange={(e) =>
                          setCurrent({ ...current, year: e.target.value })
                        }
                      />
                    </label>
                    <label>
                      科目
                      <input
                        value={current.subject}
                        onChange={(e) =>
                          setCurrent({ ...current, subject: e.target.value })
                        }
                      />
                    </label>
                    <label>
                      題號
                      <input
                        value={current.questionNumber}
                        onChange={(e) =>
                          setCurrent({
                            ...current,
                            questionNumber: e.target.value,
                          })
                        }
                      />
                    </label>
                    <label>
                      題型
                      <select
                        value={current.examType || "mcq"}
                        onChange={(e) =>
                          setCurrent({ ...current, examType: e.target.value })
                        }
                      >
                        <option value="mcq">選擇題</option>
                        <option value="short_answer">簡答題</option>
                        <option value="essay">申論題</option>
                        <option value="calculation">計算題</option>
                      </select>
                      {qualityFlags(current).type && (
                        <small>
                          系統建議：
                          {suggestedExamType(current) === "essay"
                            ? "申論題"
                            : suggestedExamType(current) === "calculation"
                              ? "計算題"
                              : "簡答題"}
                        </small>
                      )}
                    </label>
                    {accounting ? (
                      <label>
                        答案
                        <select
                          value={
                            current.teacherAnswer || current.correctAnswer || ""
                          }
                          onChange={(e) =>
                            setCurrent({
                              ...current,
                              teacherAnswer: e.target.value,
                              correctAnswer: e.target.value || null,
                            })
                          }
                        >
                          <option value="">未設定</option>
                          {["A", "B", "C", "D"].map((x) => (
                            <option key={x}>{x}</option>
                          ))}
                        </select>
                        {hasQualityAcknowledgement(
                          current,
                          "missing-answer",
                        ) && <small>已註記：原書未附答案</small>}
                      </label>
                    ) : (
                      <span />
                    )}
                  </div>
                  {!accounting && (
                    <div className="answer-version-grid">
                      <div className="answer-version-card ai-answer-card">
                        <span>AI 擬答（AI 版）</span>
                        <select
                          value={current.simulatedAnswer ?? ""}
                          onChange={(e) =>
                            setCurrent({
                              ...current,
                              simulatedAnswer: e.target.value,
                            })
                          }
                        >
                          <option value="">尚未產生</option>
                          {["A", "B", "C", "D"].map((x) => (
                            <option key={x}>{x}</option>
                          ))}
                        </select>
                        <small>
                          {current.isSimulation
                            ? "AI 獨立推論，不是老師標準答案"
                            : "本題不是全真模擬題"}
                        </small>
                        {current.isSimulation && (
                          <button
                            type="button"
                            className="ai-generate-button"
                            disabled={aiGenerating}
                            onClick={() => void generateAiSimulation()}
                          >
                            {aiGenerating ? "AI 產生中…" : "AI 產生答案與解析"}
                          </button>
                        )}
                      </div>
                      <label className="answer-version-card teacher-answer-card">
                        <span>老師答案（老師版）</span>
                        <select
                          value={
                            current.teacherAnswer || current.correctAnswer || ""
                          }
                          onChange={(e) =>
                            setCurrent({
                              ...current,
                              teacherAnswer: e.target.value,
                              correctAnswer: e.target.value || null,
                            })
                          }
                        >
                          <option value="">尚未確認</option>
                          {["A", "B", "C", "D"].map((x) => (
                            <option key={x}>{x}</option>
                          ))}
                        </select>
                        <small>
                          {current.teacherAnswer || current.correctAnswer
                            ? "已設定老師答案，前台會優先使用"
                            : "尚未設定；前台會使用 AI 擬答並標示"}
                        </small>
                      </label>
                    </div>
                  )}
                  <RichQuestionEditor
                    category={category}
                    label="題幹"
                    value={current.stem}
                    onChange={(stem) => setCurrent({ ...current, stem })}
                  />
                  {["A", "B", "C", "D"].map((key) => (
                    <RichQuestionEditor
                      category={category}
                      compact
                      key={key}
                      label={`選項 ${key}`}
                      value={current.options[key] ?? ""}
                      onChange={(value) =>
                        setCurrent({
                          ...current,
                          options: { ...current.options, [key]: value },
                        })
                      }
                    />
                  ))}
                  {accounting ? (
                    <RichQuestionEditor
                      category={category}
                      label="題目原有簡要解析"
                      value={
                        current.explanation ||
                        (accountingLongTeacherAnswer
                          ? current.teacherAnswer || ""
                          : "")
                      }
                      onChange={(value) =>
                        setCurrent(
                          accountingLongTeacherAnswer
                            ? {
                                ...current,
                                teacherAnswer: "",
                                correctAnswer: null,
                                explanation: value,
                              }
                            : { ...current, explanation: value },
                        )
                      }
                    />
                  ) : (
                    <>
                      <section className="explanation-version-fields ai-explanation-first">
                        <h2>AI 解析（AI 版）</h2>
                        <p>
                          本題 AI 產生的內容先顯示於此；老師解析仍獨立保存。
                        </p>
                        <div className="explanation-action-row">
                          {!current.isSimulation && (
                            <button
                              type="button"
                              className="ai-generate-button"
                              disabled={aiGenerating}
                              onClick={() => void generateAiExplanation()}
                            >
                              {aiGenerating
                                ? "AI 產生中…"
                                : current.aiCompleteExplanation
                                  ? "重新產生 AI 完整解析"
                                  : "AI 產生本題完整解析"}
                            </button>
                          )}
                        </div>
                        <RichQuestionEditor
                          category={category}
                          label="AI 簡要解析（AI 版）"
                          value={current.simulatedExplanation ?? ""}
                          onChange={(value) =>
                            setCurrent({
                              ...current,
                              simulatedExplanation: value,
                            })
                          }
                        />
                        <RichQuestionEditor
                          category={category}
                          label="AI 完整解析（AI 版／待老師核對）"
                          value={
                            current.aiCompleteExplanation ||
                            (current.isSimulation
                              ? (current.simulatedCompleteExplanation ?? "")
                              : "")
                          }
                          onChange={(value) =>
                            setCurrent(
                              current.isSimulation
                                ? {
                                    ...current,
                                    aiCompleteExplanation: value,
                                    simulatedCompleteExplanation: value,
                                  }
                                : { ...current, aiCompleteExplanation: value },
                            )
                          }
                        />
                      </section>
                      <RichQuestionEditor
                        category={category}
                        label="解析（題目原有簡要解析）"
                        value={current.explanation}
                        onChange={(explanation) =>
                          setCurrent({ ...current, explanation })
                        }
                      />
                      <p className="explanation-field-hint">
                        {current.explanation
                          ? "這是原始題目附帶的簡要解析，只保留作為題庫原稿，不會作為語音文本。"
                          : "原稿未附簡要解析；請以上方 AI 版解析為主，老師確認後填入老師版。"}
                      </p>
                      <section className="explanation-version-fields">
                        <h2>老師解析版本</h2>
                        <p>
                          老師完整解析由老師編輯與確認；完成後可直接作為語音解析文字。
                        </p>
                        <RichQuestionEditor
                          category={category}
                          label="老師完整解析（老師版）"
                          value={
                            current.teacherCompleteExplanation ||
                            current.completeExplanation ||
                            ""
                          }
                          onChange={(value) =>
                            setCurrent({
                              ...current,
                              teacherCompleteExplanation: value,
                              completeExplanation: value,
                            })
                          }
                        />
                      </section>
                      <p className="explanation-export-hint">
                        語音解析 TXT／ZIP
                        會匯出本題的完整解析文字（老師版優先）；尚未有完整解析的題目會輸出空白檔。
                      </p>
                    </>
                  )}
                </>
              )}{" "}
              {!accounting && (
                <QuestionMediaPanel
                  questionId={current.id}
                  questionNumber={current.questionNumber}
                />
              )}{" "}
              {richEditorOpen && (
                <footer>
                  <button disabled={saving} onClick={() => void save()}>
                    {saving ? "儲存中…" : "儲存本題"}
                  </button>
                </footer>
              )}
            </>
          ) : (
            <div className="empty-editor">
              {importing
                ? "拆題完成後會在這裡載入第一題。"
                : "可先對照左側完整原稿，再按上方「開始拆題」。"}
            </div>
          )}
        </article>
      </section>
    </main>
  );
}
