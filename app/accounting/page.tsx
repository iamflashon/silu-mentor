import type { Metadata } from "next";
import { headers } from "next/headers";
import { requireMember } from "../../lib/member-auth";
import AccountingHomeClient from "./AccountingHomeClient";
import { memberLoginPath } from "../../lib/member-login-path";
export const metadata: Metadata = { title: "中級會計課業答疑", description: "由 Luna 助教協助說明中級會計觀念、準則、計算與分錄。" };
export const dynamic = "force-dynamic";
export default async function AccountingHome(){const requestHeaders=await headers();const auth=await requireMember(new Request("https://accounting.local/accounting",{headers:requestHeaders}));if("error" in auth)return <main className="main-entry-gate"><section className="admin-login-card"><span>MEMBER ACCESS</span><div className="main-entry-logo" aria-hidden="true">智</div><h1>會員登入</h1><p>登入後才能使用中級會計學習功能。</p><a className="main-entry-medtech" href={memberLoginPath("/accounting")}>登入會員平台</a><a className="admin-login-back" href="/">回入口頁</a></section></main>;const canAdmin=auth.member.canAdmin;return <AccountingHomeClient canAdmin={canAdmin}/>}
