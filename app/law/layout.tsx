import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { requireMember } from "../../lib/member-auth";

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
  const auth = await requireMember(new Request("https://silu-mentor.invalid/law", { headers: requestHeaders }));
  if ("error" in auth) redirect("/member-login?return_to=%2Flaw");
  return children;
}
