export type PortalModuleId =
  | "ai-coach"
  | "pdf-reference"
  | "entitlements"
  | "plain-language"
  | "law-search"
  | "notes"
  | "question-bank";

export type PortalModule = {
  id: PortalModuleId;
  enabled: boolean;
  order: number;
  label: string;
  description: string;
  href: string;
  action: "route" | "dialog" | "search" | "anchor";
  icon: string;
};

export const defaultPengliModules: PortalModule[] = [
  { id: "ai-coach", enabled: true, order: 1, label: "AI 行政法教練", description: "依教材頁數對照，逐步追問與破題。", href: "/teachers/pengli/coach", action: "route", icon: "AI" },
  { id: "pdf-reference", enabled: true, order: 2, label: "PDF 對照閱讀", description: "閱讀教材並直接跳到引用頁數。", href: "/teachers/pengli/notes", action: "route", icon: "PDF" },
  { id: "entitlements", enabled: true, order: 3, label: "提問權益與點數", description: "查看免費提問、點數與使用期限。", href: "/teachers/pengli/ai-access", action: "route", icon: "點" },
  { id: "plain-language", enabled: true, order: 4, label: "白話解釋", description: "把法條與實務見解轉成易懂說明。", href: "/teachers/pengli/coach?mode=plain", action: "route", icon: "白" },
  { id: "law-search", enabled: true, order: 5, label: "法規搜尋", description: "進入法律工具，搜尋全國法規與司法院資料來源。", href: "/law", action: "search", icon: "法" },
  { id: "notes", enabled: true, order: 6, label: "我的筆記", description: "保存法條、頁數與 AI 解釋。", href: "/teachers/pengli/notes", action: "route", icon: "記" },
  { id: "question-bank", enabled: false, order: 7, label: "行政法題庫", description: "把教材考點整理成可練習題目。", href: "/teachers/pengli/questions", action: "route", icon: "題" },
];

export function normalizePortalModules(value: unknown): PortalModule[] {
  const rows = Array.isArray(value) ? value : [];
  return defaultPengliModules.map((fallback) => {
    const row = rows.find((item) => item && typeof item === "object" && (item as { id?: unknown }).id === fallback.id) as Partial<PortalModule> | undefined;
    const action = ["route", "dialog", "search", "anchor"].includes(String(row?.action)) ? row?.action as PortalModule["action"] : fallback.action;
    return { ...fallback, enabled: row?.enabled !== false, order: Number.isFinite(Number(row?.order)) ? Number(row?.order) : fallback.order, label: typeof row?.label === "string" && row.label.trim() ? row.label.trim().slice(0, 60) : fallback.label, description: typeof row?.description === "string" && row.description.trim() ? row.description.trim().slice(0, 180) : fallback.description, href: typeof row?.href === "string" && row.href.trim() ? row.href.trim().slice(0, 240) : fallback.href, action, icon: typeof row?.icon === "string" && row.icon.trim() ? row.icon.trim().slice(0, 5) : fallback.icon };
  }).sort((a, b) => a.order - b.order).map((module, index) => ({ ...module, order: index + 1 }));
}
