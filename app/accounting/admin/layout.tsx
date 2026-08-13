import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "中級會計管理後台",
  description: "中級會計教材上傳、自動拆解與索引管理。",
};

export default function AccountingAdminLayout({ children }: { children: React.ReactNode }) {
  return children;
}
