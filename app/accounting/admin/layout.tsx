import type { Metadata } from "next";
import { headers } from "next/headers";
import { requireAccountingAdmin } from "../../../lib/member-auth";
import "../../medtech/admin/question-bank.css";
import "../../medtech/admin/question-workbench.css";
import "../../medtech/admin/document-workspace/page.css";
import "../../medtech/admin/document-workspace/library.css";
import "../../medtech/admin/document-question-library.css";
import "../../medtech/admin/processing-progress.css";
import "../../medtech/admin/processing-note.css";
import "../../medtech/admin/question-workbench/page.css";
import "./product.css";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

export const metadata: Metadata = {
  title: "中級會計管理後台",
  description: "中級會計教材上傳、自動拆解與索引管理。",
};

export default async function AccountingAdminLayout({ children }: { children: React.ReactNode }) {
  const auth = await requireAccountingAdmin(new Request("https://admin.local/accounting/admin", { headers: await headers() }));
  if ("error" in auth) return <main className="medtech-member-page"><section className="medtech-member-card login"><span>ACCOUNTING ADMIN</span><h1>中級會計管理後台</h1><p>只有已開通中級會計管理權限的帳號可以進入。</p><a className="primary" href="/admin-login?return_to=%2Faccounting%2Fadmin">登入管理帳號</a><a href="/accounting">回中會首頁</a></section></main>;
  return <>
    <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", padding: "8px 24px", background: "#fffaf0", borderBottom: "1px solid #e3bd58" }}>
      <a href="/accounting/admin/document-workspace" style={{ color: "#174b43", fontWeight: 700, textDecoration: "none" }}>文件拆解工作區</a>
      <a href="/accounting/admin/questions" style={{ color: "#174b43", fontWeight: 700, textDecoration: "none" }}>拆解題庫審核</a>
    </div>
    {children}
  </>;
}
