import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "司律備考",
  description: "司律考試專屬的 AI 學習與備考平台。",
  openGraph: {
    title: "司律備考｜AI 司律考試教練",
    description: "司律考試專屬的 AI 學習與備考平台。",
  },
};

export default function LawLayout({children}:{children:React.ReactNode}) {
  return children;
}
