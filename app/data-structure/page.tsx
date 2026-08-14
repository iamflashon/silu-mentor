import type { Metadata } from "next";
import { headers } from "next/headers";
import { requireMember } from "../../lib/member-auth";
import DataStructureHomeClient from "./DataStructureHomeClient";

export const metadata: Metadata = { title: "資料結構課業答疑", description: "由 Luna 助教依資料結構教材協助說明觀念、演算法與題目。" };
export const dynamic = "force-dynamic";

export default async function DataStructureHome(){
  const requestHeaders=await headers();
  const auth=await requireMember(new Request("https://data-structure.local/data-structure",{headers:requestHeaders}));
  const canAdmin=!("error" in auth)&&auth.member.canAdmin;
  return <DataStructureHomeClient canAdmin={canAdmin}/>;
}
