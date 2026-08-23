import { headers } from "next/headers";
import { hasMedtechPermission, requireMedtechBackoffice } from "../../../lib/member-auth";
import { MedtechAdminAccessProvider } from "./MedtechAdminAccess";

export const dynamic = "force-dynamic";

export default async function MedtechAdminLayout({ children }: { children: React.ReactNode }) {
  const requestHeaders = await headers();
  const auth = await requireMedtechBackoffice(new Request("https://admin.local/medtech/admin", { headers: requestHeaders }));
  if (!("access" in auth)) return <main className="medtech-member-page"><section className="medtech-member-card login"><span>MEDTECH ADMIN</span><h1>醫檢師管理後台</h1><p>只有已開通管理或文件題庫編修權限的帳號可以進入。</p><a className="primary" href="/admin-login?return_to=%2Fmedtech%2Fadmin">登入管理帳號</a><a href="/medtech">回醫檢首頁</a></section></main>;
  return <MedtechAdminAccessProvider fullAdmin={auth.access.canAdmin} questionEditor={auth.access.canAdmin || hasMedtechPermission(auth.access.permissionsJson, "questions")}>{children}</MedtechAdminAccessProvider>;
}
