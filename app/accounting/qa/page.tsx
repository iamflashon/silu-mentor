import type { Metadata } from "next";
import { headers } from "next/headers";
import { requireMember } from "../../../lib/member-auth";
import { memberLoginPath } from "../../../lib/member-login-path";
import AccountingHomeClient from "../AccountingHomeClient";

export const metadata: Metadata = {
  title: "中級會計課業答疑｜內部測試",
  description: "中級會計 Luna 助教課業答疑測試頁。",
};

export const dynamic = "force-dynamic";

export default async function AccountingQaPage() {
  const requestHeaders = await headers();
  const auth = await requireMember(
    new Request("https://accounting.local/accounting/qa", { headers: requestHeaders }),
  );

  if ("error" in auth) {
    return <main className="main-entry-gate"><section className="admin-login-card">
      <span>MEMBER ACCESS</span><div className="main-entry-logo" aria-hidden="true">智</div>
      <h1>會員登入</h1><p>登入後才能使用中級會計課業答疑測試頁。</p>
      <a className="main-entry-medtech" href={memberLoginPath("/accounting/qa")}>登入會員平台</a>
      <a className="admin-login-back" href="/accounting">回中會練題館</a>
    </section></main>;
  }

  return <AccountingHomeClient />;
}
