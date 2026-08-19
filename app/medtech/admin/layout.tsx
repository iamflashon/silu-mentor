import { headers } from "next/headers";
import { requireMedtechAdmin } from "../../../lib/member-auth";

export const dynamic = "force-dynamic";

export default async function MedtechAdminLayout({ children }: { children: React.ReactNode }) {
  const requestHeaders = await headers();
  const auth = await requireMedtechAdmin(new Request("https://admin.local/medtech/admin", { headers: requestHeaders }));
  if ("error" in auth) return <main className="medtech-member-page"><section className="medtech-member-card login"><span>MEDTECH ADMIN</span><h1>醫檢師管理後台</h1><p>只有已開通醫檢師管理權限的帳號可以進入。</p><a className="primary" href="/admin-login?return_to=%2Fmedtech%2Fadmin">登入管理帳號</a><a href="/medtech">回醫檢首頁</a></section></main>;
  return <>{children}</>;
}
