import type { Metadata } from "next";
import AccountingHomeClient from "../AccountingHomeClient";

export const metadata: Metadata = {
  title: "中級會計課業答疑｜Luna 助教",
  description: "中級會計 Luna 助教課業答疑，支援文字、截圖與拍照提問。",
};

export const dynamic = "force-dynamic";

export default function AccountingQaPage() { return <AccountingHomeClient />; }
