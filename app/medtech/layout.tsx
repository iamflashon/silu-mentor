import type { Metadata } from "next";
import { headers } from "next/headers";
import MedtechDeviceGuard from "./MedtechDeviceGuard";
import AdminEntryRequired from "../admin-login/AdminEntryRequired";
import { isAdminEntryAuthenticated } from "../../lib/admin-entry-auth";

export const metadata: Metadata = {
  title: "醫檢師備考",
  description: "醫檢師國考題庫、錯題複習與 AI 引導學習平台。",
  openGraph: {
    title: "醫檢師備考｜醫檢國考 AI 學習",
    description: "醫檢師國考題庫、錯題複習與 AI 引導學習平台。",
  },
  twitter: {
    card: "summary",
    title: "醫檢師備考｜醫檢國考 AI 學習",
    description: "醫檢師國考題庫、錯題複習與 AI 引導學習平台。",
  },
};

export default async function MedtechLayout({children}:{children:React.ReactNode}) {
  const requestHeaders = await headers();
  const allowed = await isAdminEntryAuthenticated(new Request("https://medtech.local/medtech", { headers: requestHeaders }));
  if (!allowed) return <AdminEntryRequired returnTo="/medtech" />;
  return <>{children}<MedtechDeviceGuard /></>;
}
