import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { isAdminEntryAuthenticated } from "../../lib/admin-entry-auth";
import MedtechDeviceGuard from "./MedtechDeviceGuard";

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
  const request = new Request("https://silu-mentor.invalid/medtech", { headers: requestHeaders });
  if (!(await isAdminEntryAuthenticated(request))) redirect("/admin-login?return_to=%2Fmedtech");
  return <>{children}<MedtechDeviceGuard /></>;
}
