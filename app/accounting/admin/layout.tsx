import type { Metadata } from "next";
import "../../medtech/admin/question-bank.css";
import "../../medtech/admin/question-workbench.css";
import "../../medtech/admin/document-workspace/page.css";
import "../../medtech/admin/document-workspace/library.css";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

export const metadata: Metadata = {
  title: "中級會計管理後台",
  description: "中級會計教材上傳、自動拆解與索引管理。",
};

export default function AccountingAdminLayout({ children }: { children: React.ReactNode }) {
  return <>
    <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", padding: "8px 24px", background: "#fffaf0", borderBottom: "1px solid #e3bd58" }}>
      <a href="/accounting/admin/document-workspace" style={{ color: "#174b43", fontWeight: 700, textDecoration: "none" }}>文件拆解工作區</a>
      <a href="/accounting/admin/questions" style={{ color: "#174b43", fontWeight: 700, textDecoration: "none" }}>拆解題庫審核</a>
    </div>
    {children}
  </>;
}
