import type { Metadata } from "next";
import AccountingHomeClient from "../AccountingHomeClient";

export const metadata: Metadata = {
  title: "中級會計課業答疑｜內部測試",
  description: "中級會計 Luna 助教課業答疑測試頁。",
};

export const dynamic = "force-dynamic";

export default function AccountingQaPage() { return <AccountingHomeClient />; }
