import type { Metadata } from "next";
import { headers } from "next/headers";
import AdminEntryRequired from "../admin-login/AdminEntryRequired";
import { isAdminEntryAuthenticated } from "../../lib/admin-entry-auth";

export const metadata: Metadata = {
  title: "司律備考",
  description: "司律考試專屬的 AI 學習與備考平台。",
  openGraph: {
    title: "司律備考｜AI 司律考試教練",
    description: "司律考試專屬的 AI 學習與備考平台。",
  },
};

export default async function LawLayout({children}:{children:React.ReactNode}) {
  const requestHeaders = await headers();
  const allowed = await isAdminEntryAuthenticated(new Request("https://law.local/law", { headers: requestHeaders }));
  if (!allowed) return <AdminEntryRequired returnTo="/law" />;
  return children;
}
