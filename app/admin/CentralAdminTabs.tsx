const tabs = [
  ["library", "/admin/library", "教材向量庫"],
  ["question-bank", "/admin/question-bank", "總題庫管理"],
  ["products", "/admin/products", "書籍與商品"],
  ["members", "/admin/members", "會員總管理"],
  ["qa", "/admin/qa-test-applications", "QA 測試申請"],
  ["ai-access", "/admin/ai-access", "AI 方案與啟用碼"],
  ["portal-cards", "/admin/portal-cards", "首頁卡片管理"],
] as const;

export default function CentralAdminTabs({ active }: { active: typeof tabs[number][0] }) {
  return <nav className="central-admin-tabs" aria-label="中央管理功能切換">
    {tabs.map(([id, href, label]) => <a key={id} className={id === active ? "active" : ""} href={href}>{label}</a>)}
  </nav>;
}
