import type { Metadata } from "next";
import { headers } from "next/headers";
import { requireMember } from "../../lib/member-auth";
import AccountingHomeClient from "./AccountingHomeClient";
export const metadata: Metadata = { title: "中級會計課業答疑", description: "由 Luna 助教協助說明中級會計觀念、準則、計算與分錄。" };
export const dynamic = "force-dynamic";
export default async function AccountingHome(){const requestHeaders=await headers();const auth=await requireMember(new Request("https://accounting.local/accounting",{headers:requestHeaders}));const canAdmin=!("error" in auth)&&auth.member.canAdmin;return <AccountingHomeClient canAdmin={canAdmin}/>}
