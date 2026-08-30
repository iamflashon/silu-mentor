"use client";
import {
  ClipboardEvent,
  FormEvent,
  PointerEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import { formatTwd } from "../../lib/currency";
import AccountingPurchaseButton from "./AccountingPurchaseButton";
type Usage = {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  durationMs: number;
  estimatedCostUsd: number;
  diagramTokens?: number;
  fileSearchCalls?: number;
  modelCostUsd?: number;
  toolCostUsd?: number;
};
type Diagram = {
  title: string;
  layout?: "free" | "growth-order" | "recursive-tree";
  items?: Array<{
    id: string;
    label: string;
    formula: string;
    detail?: string;
  }>;
  notes?: Array<{ itemId: string; title: string; detail: string }>;
  treeRootId?: string;
  treeNodes?: Array<{ id: string; label: string }>;
  treeEdges?: Array<{ from: string; to: string }>;
  nodes: Array<{
    id: string;
    label: string;
    detail?: string;
    x: number;
    y: number;
    active?: boolean;
    shape?: "circle" | "box" | "label";
  }>;
  edges: Array<{
    from: string;
    to: string;
    label?: string;
    directed?: boolean;
    dashed?: boolean;
  }>;
};
type Message = {
  role: "student" | "mentor";
  text: string;
  images?: string[];
  source?: string;
  usage?: Usage;
  diagram?: Diagram;
  recordId?: number;
};
type HistoryRecord = {
  id: number;
  title: string;
  question: string;
  answer: string;
  source: string;
  model: string;
  costUsd: number;
  diagram?: Diagram;
  createdAt: string;
};
type SavedNote = {
  id: number;
  title: string;
  content: string;
  tags: string;
  sourceLabel: string;
  updatedAt: string;
};
type Crop = { x: number; y: number; width: number; height: number };
type Photo = {
  id: string;
  src: string;
  rotation: number;
  crop: Crop;
  enhance: boolean;
};
type DragMode = "move" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "nw";
type TrialState = {
  used: number;
  limit: number;
  remaining: number;
  blocked: boolean;
  pending: boolean;
};
type AccountingAiAccess = {
  active: boolean;
  quotaTotal: number;
  quotaUsed: number;
  remaining: number;
  expiresAt: string | null;
  price: number;
  quota: number;
  durationDays: number;
};
const fullCrop: Crop = { x: 0, y: 0, width: 100, height: 100 };
function PlainAnswer({ text }: { text: string }) {
  const cleaned = text
    .replace(/^\s*```(?:\w+)?\s*$/gmu, "")
    .replace(/^\s*#{1,6}\s+/gmu, "")
    .replace(/^\s*---+\s*$/gmu, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\\\[|\\\]|\\\(|\\\)/g, "")
    .replace(/\\(log|ln|sqrt|frac|cdot|times|leq|geq|approx)\b/g, "$1")
    .replace(/^\s*[-*]\s+/gmu, "• ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return (
    <div className="accounting-answer-text">
      {cleaned.split(/\n\n+/).map((block, index) => (
        <p key={index}>{block}</p>
      ))}
    </div>
  );
}
function GrowthOrderDiagram({ diagram }: { diagram: Diagram }) {
  const items = (diagram.items ?? []).slice(0, 8),
    notes = (diagram.notes ?? []).slice(0, 3),
    left = 70,
    right = 730,
    y = 142,
    step = items.length > 1 ? (right - left) / (items.length - 1) : 0,
    positions = new Map(
      items.map((item, index) => [item.id, left + index * step]),
    );
  return (
    <figure className="structure-diagram growth-order-diagram">
      <figcaption>{diagram.title}</figcaption>
      <div className="growth-scroll">
        <svg viewBox="0 0 800 430" role="img" aria-label={diagram.title}>
          <defs>
            <marker
              id="growth-arrow"
              markerWidth="9"
              markerHeight="9"
              refX="8"
              refY="4.5"
              orient="auto"
            >
              <path d="M0,0 L9,4.5 L0,9 z" fill="#0879a8" />
            </marker>
          </defs>
          <text className="speed-label slow" x="42" y="74">
            成長較慢
          </text>
          <text className="speed-label fast" x="758" y="74">
            成長較快
          </text>
          <line
            className="growth-axis"
            x1="45"
            y1={y}
            x2="755"
            y2={y}
            markerEnd="url(#growth-arrow)"
          />
          {items.map((item, index) => {
            const x = left + index * step;
            return (
              <g className="growth-item" key={item.id}>
                <line x1={x} y1={y - 14} x2={x} y2={y + 14} />
                <text className="growth-label" x={x} y="102">
                  {item.label}
                </text>
                <text className="growth-formula" x={x} y="184">
                  {item.formula}
                </text>
                {item.detail && (
                  <text className="growth-detail" x={x} y="211">
                    {item.detail}
                  </text>
                )}
              </g>
            );
          })}
          {notes.map((note, index) => {
            const x = positions.get(note.itemId) ?? 400,
              boxX = Math.max(15, Math.min(585, x - 100)),
              boxY = 260 + (index % 2) * 82;
            return (
              <g className="growth-note" key={`${note.itemId}-${index}`}>
                <line
                  className="note-link"
                  x1={x}
                  y1={y + 16}
                  x2={boxX + 100}
                  y2={boxY}
                />
                <rect x={boxX} y={boxY} width="200" height="66" rx="8" />
                <text x={boxX + 100} y={boxY + 25}>
                  <tspan x={boxX + 100}>{note.title}</tspan>
                  <tspan className="detail" x={boxX + 100} dy="22">
                    {note.detail}
                  </tspan>
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    </figure>
  );
}
function RecursiveTreeDiagram({ diagram }: { diagram: Diagram }) {
  const nodes = (diagram.treeNodes ?? []).slice(0, 48),
    edges = (diagram.treeEdges ?? []).slice(0, 64),
    root = diagram.treeRootId ?? nodes[0]?.id;
  if (!root) return null;
  const byId = new Map(nodes.map((node) => [node.id, node])),
    children = new Map<string, string[]>();
  edges.forEach((edge) => {
    if (byId.has(edge.from) && byId.has(edge.to))
      children.set(edge.from, [...(children.get(edge.from) ?? []), edge.to]);
  });
  const positions = new Map<string, { x: number; y: number }>(),
    visiting = new Set<string>();
  let leaf = 0,
    maxDepth = 0;
  const place = (id: string, depth: number): number => {
    if (visiting.has(id) || depth > 8) return 0;
    visiting.add(id);
    maxDepth = Math.max(maxDepth, depth);
    const kids = (children.get(id) ?? []).filter(
      (child) => !visiting.has(child),
    );
    const x = kids.length
      ? kids
          .map((child) => place(child, depth + 1))
          .reduce((sum, value) => sum + value, 0) / kids.length
      : leaf++;
    positions.set(id, { x, y: depth });
    return x;
  };
  place(root, 0);
  const width = Math.max(760, Math.max(1, leaf) * 86),
    height = Math.max(300, (maxDepth + 1) * 92 + 55),
    px = (x: number) => 55 + (width - 110) * (leaf <= 1 ? 0.5 : x / (leaf - 1)),
    py = (depth: number) => 48 + depth * 92;
  return (
    <figure className="structure-diagram recursive-tree-diagram">
      <figcaption>{diagram.title}</figcaption>
      <div className="tree-scroll">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label={diagram.title}
        >
          {edges.map((edge, index) => {
            const from = positions.get(edge.from),
              to = positions.get(edge.to);
            return from && to ? (
              <line
                key={index}
                x1={px(from.x)}
                y1={py(from.y) + 8}
                x2={px(to.x)}
                y2={py(to.y) - 18}
              />
            ) : null;
          })}
          {nodes.map((node) => {
            const pos = positions.get(node.id);
            return pos ? (
              <text
                className="tree-node"
                key={node.id}
                x={px(pos.x)}
                y={py(pos.y)}
              >
                {node.label}
              </text>
            ) : null;
          })}
        </svg>
      </div>
    </figure>
  );
}
function StructureDiagram({ diagram }: { diagram: Diagram }) {
  if (diagram.layout === "growth-order" && diagram.items?.length)
    return <GrowthOrderDiagram diagram={diagram} />;
  if (diagram.layout === "recursive-tree" && diagram.treeNodes?.length)
    return <RecursiveTreeDiagram diagram={diagram} />;
  const byId = new Map(diagram.nodes.map((node) => [node.id, node]));
  return (
    <figure className="structure-diagram">
      <figcaption>{diagram.title}</figcaption>
      <svg viewBox="0 0 800 420" role="img" aria-label={diagram.title}>
        <defs>
          <marker
            id="structure-arrow"
            markerWidth="8"
            markerHeight="8"
            refX="7"
            refY="4"
            orient="auto"
          >
            <path d="M0,0 L8,4 L0,8 z" fill="#0879a8" />
          </marker>
        </defs>
        {diagram.edges.map((edge, index) => {
          const from = byId.get(edge.from),
            to = byId.get(edge.to);
          if (!from || !to) return null;
          const mx = (from.x + to.x) / 2,
            my = (from.y + to.y) / 2;
          return (
            <g key={index} className={edge.dashed ? "dashed" : ""}>
              <line
                x1={from.x}
                y1={from.y}
                x2={to.x}
                y2={to.y}
                markerEnd={
                  edge.directed === false ? undefined : "url(#structure-arrow)"
                }
              />
              {edge.label && (
                <text x={mx} y={my - 8}>
                  {edge.label}
                </text>
              )}
            </g>
          );
        })}
        {diagram.nodes.map((node) => (
          <g
            key={node.id}
            className={`${node.active ? "active " : ""}${node.shape || "circle"}`}
          >
            {node.shape === "box" ? (
              <rect
                x={node.x - 72}
                y={node.y - 30}
                width="144"
                height={node.detail ? 72 : 60}
                rx="8"
              />
            ) : (
              node.shape !== "label" && (
                <circle cx={node.x} cy={node.y} r="30" />
              )
            )}
            <text x={node.x} y={node.y + (node.shape === "label" ? 0 : 5)}>
              <tspan x={node.x}>{node.label}</tspan>
              {node.detail && (
                <tspan className="detail" x={node.x} dy="22">
                  {node.detail}
                </tspan>
              )}
            </text>
          </g>
        ))}
      </svg>
    </figure>
  );
}

function CropDialog({
  photo,
  onCancel,
  onConfirm,
}: {
  photo: Photo;
  onCancel: () => void;
  onConfirm: (crop: Crop) => void;
}) {
  const [crop, setCrop] = useState<Crop>(photo.crop),
    drag = useRef<{ mode: DragMode; x: number; y: number; crop: Crop } | null>(
      null,
    ),
    stageRef = useRef<HTMLDivElement>(null);
  const begin = (event: PointerEvent, mode: DragMode) => {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = {
      mode,
      x: event.clientX,
      y: event.clientY,
      crop: { ...crop },
    };
  };
  const move = (event: PointerEvent) => {
    if (!drag.current || !stageRef.current) return;
    const rect = stageRef.current.getBoundingClientRect(),
      dx = ((event.clientX - drag.current.x) / rect.width) * 100,
      dy = ((event.clientY - drag.current.y) / rect.height) * 100,
      start = drag.current.crop,
      min = 5;
    let { x, y, width, height } = start;
    const mode = drag.current.mode;
    if (mode === "move") {
      x = Math.max(0, Math.min(100 - width, start.x + dx));
      y = Math.max(0, Math.min(100 - height, start.y + dy));
    } else {
      if (mode.includes("w")) {
        x = Math.max(0, Math.min(start.x + start.width - min, start.x + dx));
        width = start.width + (start.x - x);
      }
      if (mode.includes("e"))
        width = Math.max(min, Math.min(100 - start.x, start.width + dx));
      if (mode.includes("n")) {
        y = Math.max(0, Math.min(start.y + start.height - min, start.y + dy));
        height = start.height + (start.y - y);
      }
      if (mode.includes("s"))
        height = Math.max(min, Math.min(100 - start.y, start.height + dy));
    }
    setCrop({ x, y, width, height });
  };
  const handles: DragMode[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
  return (
    <div
      className="accounting-crop-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="裁切題目圖片"
      onPointerMove={move}
      onPointerUp={() => {
        drag.current = null;
      }}
      onPointerCancel={() => {
        drag.current = null;
      }}
    >
      <section className="accounting-crop-dialog">
        <header>
          <div>
            <b>裁切題目圖片</b>
            <small>拖曳四個角或四條框線，框內會保留</small>
          </div>
          <button type="button" aria-label="關閉裁切" onClick={onCancel}>
            ×
          </button>
        </header>
        <div className="accounting-crop-workspace">
          <div className="accounting-crop-stage" ref={stageRef}>
            <img src={photo.src} alt="完整待裁切題目" draggable={false} />
            <div
              className="accounting-crop-box"
              style={{
                left: `${crop.x}%`,
                top: `${crop.y}%`,
                width: `${crop.width}%`,
                height: `${crop.height}%`,
              }}
              onPointerDown={(event) => begin(event, "move")}
            >
              <i className="crop-grid one" />
              <i className="crop-grid two" />
              <i className="crop-grid three" />
              <i className="crop-grid four" />
              {(["n", "e", "s", "w"] as DragMode[]).map((edge) => (
                <i
                  key={edge}
                  className={`crop-edge ${edge}`}
                  onPointerDown={(event) => begin(event, edge)}
                />
              ))}
              {handles.map((handle) => (
                <button
                  key={handle}
                  type="button"
                  className={`crop-handle ${handle}`}
                  aria-label={`拖曳裁切框 ${handle}`}
                  onPointerDown={(event) => begin(event, handle)}
                />
              ))}
            </div>
          </div>
        </div>
        <footer>
          <button type="button" onClick={() => setCrop(fullCrop)}>
            重設整張
          </button>
          <span>
            {Math.round(crop.width)}% × {Math.round(crop.height)}%
          </span>
          <div>
            <button type="button" onClick={onCancel}>
              取消
            </button>
            <button
              type="button"
              className="primary"
              onClick={() => onConfirm(crop)}
            >
              確認裁切
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}

export default function AccountingCoach({
  canAdmin = false,
  apiEndpoint = "/api/accounting/tutor",
  coachId = "accounting-coach",
  placeholder = "輸入中會觀念、計算、分錄，或說明照片中哪裡看不懂…",
  adminHint = "讓 AI 續問目前題目，或從正式中會題庫抽下一題。",
  enableQuestionSimulation = true,
  trialMode = false,
}: {
  canAdmin?: boolean;
  apiEndpoint?: string;
  coachId?: string;
  placeholder?: string;
  adminHint?: string;
  enableQuestionSimulation?: boolean;
  trialMode?: boolean;
}) {
  const [messages, setMessages] = useState<Message[]>([]),
    [input, setInput] = useState(""),
    [loading, setLoading] = useState(false),
    [simulating, setSimulating] = useState<"question" | "followup" | null>(
      null,
    ),
    [error, setError] = useState(""),
    [photos, setPhotos] = useState<Photo[]>([]),
    [editingId, setEditingId] = useState<string | null>(null),
    [learningTab, setLearningTab] = useState<"chat" | "history" | "notes">(
      "chat",
    ),
    [history, setHistory] = useState<HistoryRecord[]>([]),
    [notes, setNotes] = useState<SavedNote[]>([]),
    [recordsLoading, setRecordsLoading] = useState(false),
    [savedIds, setSavedIds] = useState<Set<number>>(new Set()),
    [trial, setTrial] = useState<TrialState | null>(null),
    [requestForm, setRequestForm] = useState({
      displayName: "",
      email: "",
      reason: "",
    }),
    [requestNotice, setRequestNotice] = useState(""),
    [accountingAi, setAccountingAi] = useState<AccountingAiAccess | null>(null),
    [voucherCode, setVoucherCode] = useState(""),
    [voucherNotice, setVoucherNotice] = useState(""),
    [voucherBusy, setVoucherBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null),
    isDataStructure = apiEndpoint.includes("data-structure"),
    isAccounting = apiEndpoint.includes("/accounting/"),
    hasLearningRecords = !trialMode && (isDataStructure || isAccounting),
    recordCategory = isAccounting ? "accounting" : "data-structure",
    recordSubject = isAccounting ? "中級會計學" : "資料結構";
  async function loadTrial() {
    if (!trialMode) return;
    const response = await fetch("/api/accounting/qa-access", {
        cache: "no-store",
      }),
      result = (await response.json()) as TrialState;
    if (response.ok) setTrial(result);
  }
  useEffect(() => {
    void loadTrial();
  }, [trialMode]);
  async function loadAccountingAi() {
    if (!isAccounting || trialMode) return;
    const response = await fetch("/api/accounting/ai-access", {
      cache: "no-store",
    });
    if (response.ok)
      setAccountingAi((await response.json()) as AccountingAiAccess);
  }
  useEffect(() => {
    void loadAccountingAi();
  }, [isAccounting, trialMode]);
  async function redeemAccountingVoucher(event: FormEvent) {
    event.preventDefault();
    setVoucherBusy(true);
    setVoucherNotice("兌換中…");
    const response = await fetch("/api/ai-access", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: voucherCode }),
    });
    const result = (await response.json()) as { error?: string };
    if (response.ok) {
      setVoucherCode("");
      setVoucherNotice("兌換成功，課業答疑次數已加入帳號。");
      await loadAccountingAi();
    } else setVoucherNotice(result.error || "兌換失敗，請確認兌換碼。");
    setVoucherBusy(false);
  }
  async function requestMore(event: FormEvent) {
    event.preventDefault();
    setRequestNotice("送出中…");
    const response = await fetch("/api/accounting/qa-access", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(requestForm),
      }),
      result = (await response.json()) as { error?: string; message?: string };
    setRequestNotice(
      response.ok
        ? result.message || "申請已送出。"
        : result.error || "申請失敗",
    );
    if (response.ok) await loadTrial();
  }
  async function loadLearningData(tab: typeof learningTab) {
    if (!hasLearningRecords || tab === "chat") return;
    setRecordsLoading(true);
    setError("");
    try {
      if (tab === "history") {
        const response = await fetch(`/api/${recordCategory}/history`, {
            cache: "no-store",
          }),
          result = (await response.json()) as {
            records?: HistoryRecord[];
            error?: string;
          };
        if (!response.ok) throw new Error(result.error || "無法讀取問答紀錄");
        setHistory(result.records ?? []);
      } else {
        const response = await fetch(`/api/notes?category=${recordCategory}`, {
            cache: "no-store",
          }),
          result = (await response.json()) as {
            notes?: SavedNote[];
            error?: string;
          };
        if (!response.ok) throw new Error(result.error || "無法讀取筆記");
        setNotes(result.notes ?? []);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "讀取失敗");
    } finally {
      setRecordsLoading(false);
    }
  }
  useEffect(() => {
    void loadLearningData(learningTab);
  }, [learningTab]);
  async function saveRecordAsNote(record: HistoryRecord) {
    setError("");
    try {
      const response = await fetch("/api/notes", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            category: recordCategory,
            sourceType: `${recordCategory}-qa`,
            sourceId: `${recordCategory}-${record.id}`,
            title: record.title || record.question.slice(0, 48),
            content: `題目\n${record.question}\n\n解答\n${record.answer}${record.source ? `\n\n教材來源\n${record.source}` : ""}`,
            originalContent: record.diagram
              ? JSON.stringify(record.diagram)
              : "",
            subject: recordSubject,
            tags: `${recordSubject},課業答疑`,
            sourceLabel: record.source || "Luna 助教答疑",
          }),
        }),
        result = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(result.error || "無法存成筆記");
      setSavedIds((current) => new Set(current).add(record.id));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "無法存成筆記");
    }
  }
  async function deleteHistory(id: number) {
    if (!confirm("確定刪除這則問答紀錄？")) return;
    const response = await fetch(`/api/${recordCategory}/history?id=${id}`, {
      method: "DELETE",
    });
    if (response.ok) setHistory((rows) => rows.filter((row) => row.id !== id));
    else setError("無法刪除問答紀錄");
  }
  async function updateNote(note: SavedNote) {
    const response = await fetch("/api/notes", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: note.id,
        category: recordCategory,
        title: note.title,
        content: note.content,
        subject: recordSubject,
        tags: note.tags,
      }),
    });
    if (!response.ok) setError("無法更新筆記");
  }
  async function deleteNote(id: number) {
    if (!confirm("確定刪除這則筆記？")) return;
    const response = await fetch(
      `/api/notes?id=${id}&category=${recordCategory}`,
      { method: "DELETE" },
    );
    if (response.ok) setNotes((rows) => rows.filter((row) => row.id !== id));
    else setError("無法刪除筆記");
  }
  async function addFiles(files: File[]) {
    const accepted = files
      .filter((file) => file.type.startsWith("image/"))
      .slice(0, 2 - photos.length);
    if (!accepted.length) {
      setError(
        photos.length >= 2
          ? "一次最多兩張；跨頁請依順序加入。"
          : "請選擇圖片檔案。",
      );
      return;
    }
    const added = await Promise.all(
      accepted.map(
        (file) =>
          new Promise<Photo>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () =>
              resolve({
                id: crypto.randomUUID(),
                src: String(reader.result),
                rotation: 0,
                crop: { ...fullCrop },
                enhance: false,
              });
            reader.onerror = reject;
            reader.readAsDataURL(file);
          }),
      ),
    );
    setPhotos((current) => [...current, ...added]);
    setError("");
  }
  async function render(photo: Photo) {
    const image = new Image();
    image.src = photo.src;
    await image.decode();
    const sx = Math.round((image.width * photo.crop.x) / 100),
      sy = Math.round((image.height * photo.crop.y) / 100),
      sw = Math.max(1, Math.round((image.width * photo.crop.width) / 100)),
      sh = Math.max(1, Math.round((image.height * photo.crop.height) / 100)),
      turn = Math.abs(photo.rotation / 90) % 2 === 1,
      canvas = document.createElement("canvas");
    canvas.width = turn ? sh : sw;
    canvas.height = turn ? sw : sh;
    const context = canvas.getContext("2d")!;
    context.translate(canvas.width / 2, canvas.height / 2);
    context.rotate((photo.rotation * Math.PI) / 180);
    if (photo.enhance)
      context.filter = "contrast(1.35) brightness(1.08) saturate(.25)";
    context.drawImage(image, sx, sy, sw, sh, -sw / 2, -sh / 2, sw, sh);
    return canvas.toDataURL("image/jpeg", 0.84);
  }
  async function send(value = input) {
    const text =
      value.trim() ||
      (photos.length === 1
        ? "老師您好，想請您幫我看一下這張題目圖片，並說明解題觀念與步驟，謝謝。"
        : photos.length > 1
          ? `老師您好，想請您依序閱讀這 ${photos.length} 張跨頁題目圖片，並說明解題觀念與步驟，謝謝。`
          : "");
    if (!text || loading || trial?.blocked) return;
    setInput("");
    setLoading(true);
    setError("");
    try {
      const imageDataUrls = await Promise.all(photos.map(render));
      const next = [
        ...messages,
        {
          role: "student" as const,
          text,
          images: imageDataUrls.length ? imageDataUrls : undefined,
        },
      ];
      setMessages(next);
      setPhotos([]);
      setEditingId(null);
      const response = await fetch(apiEndpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          messages: next.map(({ role, text }) => ({ role, text })),
          mode: "free",
          imageDataUrls,
          trialMode,
        }),
      });
      const result = (await response.json()) as {
        reply?: string;
        source?: string;
        usage?: Usage;
        diagram?: Diagram;
        recordId?: number;
        error?: string;
        trial?: TrialState;
        aiAccess?: { remaining?: number | null };
      };
      if (!response.ok || !result.reply) {
        if (result.trial) setTrial(result.trial);
        throw new Error(result.error || "Luna 助教暫時無法回答");
      }
      setMessages((current) => [
        ...current,
        {
          role: "mentor",
          text: result.reply!,
          source: result.source,
          usage: result.usage,
          diagram: result.diagram,
          recordId: result.recordId,
        },
      ]);
      if (result.trial) setTrial(result.trial);
      else if (trialMode) await loadTrial();
      else if (isAccounting) await loadAccountingAi();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Luna 助教暫時無法回答",
      );
    } finally {
      setLoading(false);
    }
  }
  async function simulateQuestion() {
    if (loading || simulating) return;
    setSimulating("question");
    setError("");
    try {
      const response = await fetch("/api/accounting/simulated-question", {
        cache: "no-store",
      });
      const result = (await response.json()) as {
        prompt?: string;
        error?: string;
      };
      if (!response.ok || !result.prompt)
        throw new Error(result.error || "題庫目前無法抽題");
      await send(result.prompt);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "題庫目前無法抽題");
    } finally {
      setSimulating(null);
    }
  }
  async function simulateFollowUp() {
    if (
      loading ||
      simulating ||
      messages.at(-1)?.role !== "mentor" ||
      messages.length < 2
    )
      return;
    setSimulating("followup");
    setError("");
    try {
      const response = await fetch(apiEndpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          messages: messages.map(({ role, text }) => ({ role, text })),
          mode: "free",
          level: "入門",
          simulateStudent: true,
        }),
      });
      const result = (await response.json()) as {
        reply?: string;
        error?: string;
      };
      if (!response.ok || !result.reply)
        throw new Error(result.error || "模擬學生暫時無法續問");
      await send(result.reply);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "模擬學生暫時無法續問");
    } finally {
      setSimulating(null);
    }
  }
  const paste = (event: ClipboardEvent) => {
    const files = Array.from(event.clipboardData.files);
    if (files.length) {
      event.preventDefault();
      void addFiles(files);
    }
  };
  const editing = photos.find((photo) => photo.id === editingId);
  return (
    <section className="accounting-coach" id={coachId}>
      <header>
        <div>
          <span>Luna 助教答疑</span>
        </div>
      </header>
      {!trialMode && isAccounting && (
        <section className="accounting-ai-plan" id="accounting-ai-purchase">
          <div>
            <b>中會課業答疑專用次數</b>
            <p>
              {accountingAi?.active
                ? `目前剩餘 ${accountingAi.remaining} 次；有效至 ${new Date(accountingAi.expiresAt!).toLocaleDateString("zh-TW")}`
                : "每次成功回答扣 1 次；僅限中級會計課業答疑使用。"}
            </p>
            <small>30 次／30 天／不自動續約</small>
          </div>
          <AccountingPurchaseButton
            active
            plan="ai"
            label="LINE Pay 購買 30 次 NT$30"
          />
          <form
            className="accounting-ai-voucher"
            onSubmit={redeemAccountingVoucher}
          >
            <label>
              輸入中會 AI 兌換碼
              <input
                value={voucherCode}
                onChange={(event) =>
                  setVoucherCode(event.target.value.toUpperCase())
                }
                placeholder="IB-AI-XXXX-XXXX"
                autoComplete="off"
              />
            </label>
            <button disabled={voucherBusy || !voucherCode.trim()} type="submit">
              {voucherBusy ? "兌換中…" : "兌換到我的帳號"}
            </button>
            {voucherNotice && <small>{voucherNotice}</small>}
          </form>
        </section>
      )}
      {trialMode && (
        <section className="qa-trial-rule">
          <div>
            <b>公開測試規則</b>
            <p>
              每個裝置可免費提問 10 次；第 10 次回答完成後額度用盡，第 11
              次起暫停提問。需要繼續測試時，請送出申請，經管理者核准後會自動補發次數。
            </p>
            <small>重整或更換瀏覽器不會重置額度；申請不代表自動核准。</small>
          </div>
          <strong>
            {trial
              ? `剩餘 ${trial.remaining}／${trial.limit} 次`
              : "正在確認額度…"}
          </strong>
        </section>
      )}
      {trialMode && trial?.blocked && (
        <form className="qa-trial-application" onSubmit={requestMore}>
          <h3>{trial.pending ? "申請已送出" : "免費測試次數已用完"}</h3>
          {trial.pending ? (
            <p>請等候管理者審核；核准後重新整理此頁即可恢復提問。</p>
          ) : (
            <>
              <p>請填寫資料申請繼續測試。</p>
              <div>
                <label>
                  稱呼
                  <input
                    required
                    value={requestForm.displayName}
                    onChange={(e) =>
                      setRequestForm({
                        ...requestForm,
                        displayName: e.target.value,
                      })
                    }
                  />
                </label>
                <label>
                  Email
                  <input
                    required
                    type="email"
                    value={requestForm.email}
                    onChange={(e) =>
                      setRequestForm({ ...requestForm, email: e.target.value })
                    }
                  />
                </label>
              </div>
              <label>
                申請理由
                <textarea
                  required
                  minLength={5}
                  value={requestForm.reason}
                  onChange={(e) =>
                    setRequestForm({ ...requestForm, reason: e.target.value })
                  }
                />
              </label>
              <button type="submit">申請繼續測試</button>
            </>
          )}
          {requestNotice && <small>{requestNotice}</small>}
        </form>
      )}
      {hasLearningRecords && (
        <nav
          className="data-learning-tabs"
          aria-label={`${recordSubject}學習內容`}
        >
          <button
            className={learningTab === "chat" ? "active" : ""}
            onClick={() => setLearningTab("chat")}
          >
            課業答疑
          </button>
          <button
            className={learningTab === "history" ? "active" : ""}
            onClick={() => setLearningTab("history")}
          >
            問答紀錄
          </button>
          <button
            className={learningTab === "notes" ? "active" : ""}
            onClick={() => setLearningTab("notes")}
          >
            我的筆記
          </button>
        </nav>
      )}
      {learningTab === "history" && (
        <section className="data-learning-library">
          {recordsLoading ? (
            <p>正在讀取問答紀錄…</p>
          ) : history.length ? (
            history.map((record) => (
              <article key={record.id}>
                <header>
                  <div>
                    <b>{record.title}</b>
                    <small>
                      {new Date(record.createdAt).toLocaleString("zh-TW")}
                    </small>
                  </div>
                  <div>
                    <button onClick={() => void saveRecordAsNote(record)}>
                      {savedIds.has(record.id) ? "已存筆記" : "存成筆記"}
                    </button>
                    <button
                      className="danger"
                      onClick={() => void deleteHistory(record.id)}
                    >
                      刪除
                    </button>
                  </div>
                </header>
                <details>
                  <summary>查看完整問答</summary>
                  <h4>題目</h4>
                  <PlainAnswer text={record.question} />
                  <h4>解答</h4>
                  <PlainAnswer text={record.answer} />
                  {record.diagram && (
                    <StructureDiagram diagram={record.diagram} />
                  )}{" "}
                  {record.source && (
                    <small className="accounting-source">{record.source}</small>
                  )}
                  <small>
                    {record.model}・約 NT$ {formatTwd(record.costUsd, 4)}
                  </small>
                </details>
              </article>
            ))
          ) : (
            <p className="empty">目前還沒有問答紀錄；送出問題後會自動保存。</p>
          )}
        </section>
      )}
      {learningTab === "notes" && (
        <section className="data-learning-library notes">
          {recordsLoading ? (
            <p>正在讀取筆記…</p>
          ) : notes.length ? (
            notes.map((note) => (
              <article key={note.id}>
                <header>
                  <input
                    value={note.title}
                    onChange={(event) =>
                      setNotes((rows) =>
                        rows.map((row) =>
                          row.id === note.id
                            ? { ...row, title: event.target.value }
                            : row,
                        ),
                      )
                    }
                  />
                  <div>
                    <button onClick={() => void updateNote(note)}>
                      儲存修改
                    </button>
                    <button
                      className="danger"
                      onClick={() => void deleteNote(note.id)}
                    >
                      刪除
                    </button>
                  </div>
                </header>
                <textarea
                  value={note.content}
                  onChange={(event) =>
                    setNotes((rows) =>
                      rows.map((row) =>
                        row.id === note.id
                          ? { ...row, content: event.target.value }
                          : row,
                      ),
                    )
                  }
                />
                <small>{note.sourceLabel}</small>
              </article>
            ))
          ) : (
            <p className="empty">
              目前還沒有{recordSubject}筆記；可從問答紀錄一鍵建立。
            </p>
          )}
        </section>
      )}
      {learningTab === "chat" && (messages.length > 0 || loading) && (
        <div className="accounting-chat">
          {messages.map((message, index) => (
            <article className={message.role} key={index}>
              <b>{message.role === "mentor" ? "Luna 助教" : "學生"}</b>
              <PlainAnswer text={message.text} />
              {message.diagram && (
                <StructureDiagram diagram={message.diagram} />
              )}{" "}
              {message.images && (
                <div className="accounting-message-images">
                  {message.images.map((src, imageIndex) => (
                    <img
                      src={src}
                      alt={`已送出的題目圖片 ${imageIndex + 1}`}
                      key={imageIndex}
                    />
                  ))}
                </div>
              )}
              {message.source && (
                <small className="accounting-source">{message.source}</small>
              )}
              {message.recordId && (
                <button
                  className="save-answer-note"
                  type="button"
                  onClick={() =>
                    void saveRecordAsNote({
                      id: message.recordId!,
                      title:
                        messages[index - 1]?.text.slice(0, 80) ||
                        `${recordSubject}課業答疑`,
                      question: messages[index - 1]?.text || "",
                      answer: message.text,
                      source: message.source || "",
                      model: message.usage?.model || "Luna",
                      costUsd: message.usage?.estimatedCostUsd || 0,
                      diagram: message.diagram,
                      createdAt: new Date().toISOString(),
                    })
                  }
                >
                  {savedIds.has(message.recordId) ? "✓ 已存成筆記" : "存成筆記"}
                </button>
              )}
              {message.usage && (
                <div className="accounting-usage">
                  <b>{message.usage.model}</b>
                  <span>
                    文字輸入 {message.usage.inputTokens.toLocaleString()}・輸出{" "}
                    {message.usage.outputTokens.toLocaleString()} Tokens
                  </span>
                  {Boolean(message.usage.diagramTokens) && (
                    <span>
                      SVG 圖解約 {message.usage.diagramTokens!.toLocaleString()}{" "}
                      Tokens（已含於輸出）
                    </span>
                  )}
                  {Boolean(message.usage.fileSearchCalls) && (
                    <span>教材檢索 {message.usage.fileSearchCalls} 次</span>
                  )}
                  <span>
                    模型約 NT${" "}
                    {formatTwd(
                      message.usage.modelCostUsd ??
                        message.usage.estimatedCostUsd,
                      4,
                    )}
                    {Boolean(message.usage.toolCostUsd) &&
                      `・檢索約 NT$ ${formatTwd(message.usage.toolCostUsd!, 4)}`}
                  </span>
                  <span>
                    合計約 NT$ {formatTwd(message.usage.estimatedCostUsd, 4)}・
                    {(message.usage.durationMs / 1000).toFixed(1)} 秒
                  </span>
                </div>
              )}
            </article>
          ))}
          {loading && (
            <article className="mentor loading">
              <b>Luna 助教</b>
              <p>正在整理你的問題與計算步驟…</p>
            </article>
          )}
        </div>
      )}
      {learningTab === "chat" && (
        <section
          className={`accounting-photo-question ${photos.length ? "has-photos" : "compact"}`}
          onPaste={paste}
        >
          <header>
            <div>
              <b>{photos.length ? "上傳題目／拍照提問" : "圖片提問"}</b>
              {photos.length && <small>跨頁最多兩張，依頁面順序一起判讀</small>}
            </div>
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={photos.length >= 2}
            >
              ＋ 上傳圖片／拍照
            </button>
            <input
              ref={fileRef}
              hidden
              type="file"
              accept="image/*"
              capture="environment"
              multiple
              onChange={(e) => {
                void addFiles(Array.from(e.target.files || []));
                e.target.value = "";
              }}
            />
          </header>
          {photos.length > 0 && (
            <div className="accounting-photo-grid">
              {photos.map((photo, index) => (
                <article key={photo.id}>
                  <span>第 {index + 1} 頁</span>
                  <div className="accounting-photo-preview">
                    <img
                      src={photo.src}
                      alt={`題目第 ${index + 1} 頁`}
                      style={{
                        transform: `rotate(${photo.rotation}deg)`,
                        filter: photo.enhance
                          ? "contrast(1.35) brightness(1.08) grayscale(.35)"
                          : "none",
                      }}
                    />
                  </div>
                  <nav>
                    <button
                      type="button"
                      onClick={() => setEditingId(photo.id)}
                    >
                      ✂ 裁切圖片
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setPhotos((rows) =>
                          rows.map((item) =>
                            item.id === photo.id
                              ? { ...item, rotation: item.rotation - 90 }
                              : item,
                          ),
                        )
                      }
                    >
                      ↶ 旋轉
                    </button>
                    <button
                      type="button"
                      className={photo.enhance ? "active" : ""}
                      onClick={() =>
                        setPhotos((rows) =>
                          rows.map((item) =>
                            item.id === photo.id
                              ? { ...item, enhance: !item.enhance }
                              : item,
                          ),
                        )
                      }
                    >
                      ✨ 文字加強
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setPhotos((rows) =>
                          rows.filter((item) => item.id !== photo.id),
                        )
                      }
                    >
                      移除
                    </button>
                  </nav>
                </article>
              ))}
            </div>
          )}
        </section>
      )}
      {learningTab === "chat" && (
        <form
          onSubmit={(event: FormEvent) => {
            event.preventDefault();
            void send();
          }}
        >
          <textarea
            rows={4}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onPaste={paste}
            placeholder={placeholder}
          />
          <button disabled={loading || (!input.trim() && !photos.length)}>
            送出
          </button>
        </form>
      )}
      {error && <p className="accounting-chat-error">{error}</p>}
      {learningTab === "chat" && canAdmin && (
        <section className="accounting-admin-simulation">
          <div>
            <b>管理員檢索測試</b>
            <small>{adminHint}</small>
          </div>
          <div className="accounting-admin-simulation-actions">
            <button
              type="button"
              onClick={() => void simulateFollowUp()}
              disabled={
                loading ||
                Boolean(simulating) ||
                messages.at(-1)?.role !== "mentor" ||
                messages.length < 2
              }
            >
              {simulating === "followup" ? "AI 正在思考續問…" : "AI 模擬續問"}
            </button>
            {enableQuestionSimulation && (
              <button
                type="button"
                onClick={() => void simulateQuestion()}
                disabled={loading || Boolean(simulating)}
              >
                {simulating === "question" ? "正在從題庫抽題…" : "抽下一題"}
              </button>
            )}
          </div>
        </section>
      )}
      {editing && (
        <CropDialog
          photo={editing}
          onCancel={() => setEditingId(null)}
          onConfirm={(crop) => {
            setPhotos((rows) =>
              rows.map((item) =>
                item.id === editing.id ? { ...item, crop } : item,
              ),
            );
            setEditingId(null);
          }}
        />
      )}
    </section>
  );
}
