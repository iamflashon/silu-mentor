import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { requireAdmin } from "../../lib/member-auth";
import { safeReturnTo } from "../../lib/admin-entry-auth";

export const dynamic = "force-dynamic";

export default async function AdminLoginPage({ searchParams }:{ searchParams?:Promise<{return_to?:string}> }) {
  const params = await searchParams;
  const returnTo = safeReturnTo(params?.return_to, "/admin");
  const auth = await requireAdmin(new Request("https://admin.local/admin-login", { headers: await headers() }));
  if (!("error" in auth)) redirect(returnTo);

  return <main className="main-entry-gate"><section className="admin-login-card"><span>ADMINISTRATOR ACCESS</span><div className="main-entry-logo" aria-hidden="true">智</div><h1>此 Google 帳號沒有管理權限</h1><p>Cloudflare Access 已完成身分驗證；平台只會依相同 Email 的既有會員資料判斷管理權限，不再使用第二組管理員帳密。</p><a className="main-entry-medtech" href="/cdn-cgi/access/logout">切換 Google 帳號</a><a className="admin-login-back" href="/">回入口頁</a></section></main>;
}
