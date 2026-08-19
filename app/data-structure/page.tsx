import type { Metadata } from "next";
import { headers } from "next/headers";
import { requireMember } from "../../lib/member-auth";
import DataStructureHomeClient from "./DataStructureHomeClient";
import { memberLoginPath } from "../../lib/member-login-path";

export const metadata: Metadata = { title: "資料結構課業答疑", description: "由 Luna 助教依資料結構教材協助說明觀念、演算法與題目。" };
export const dynamic = "force-dynamic";

export default async function DataStructureHome(){
  const requestHeaders=await headers();
  const auth=await requireMember(new Request("https://data-structure.local/data-structure",{headers:requestHeaders}));
  if ("error" in auth) return <main className="main-entry-gate"><section className="admin-login-card"><span>MEMBER ACCESS</span><div className="main-entry-logo" aria-hidden="true">智</div><h1>會員登入</h1><p>登入後才能使用資料結構學習功能。</p><a className="main-entry-medtech" href={memberLoginPath("/data-structure")}>登入會員平台</a><a className="admin-login-back" href="/">回入口頁</a></section></main>;
  const canAdmin=!("error" in auth)&&auth.member.canAdmin;
  return <DataStructureHomeClient canAdmin={canAdmin}/>;
}
