import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import GlobalSelectionTools from "./global-selection-tools";
import StudyBreakReminder from "./study-break-reminder";
import NavigationFeedback from "./navigation-feedback";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: { default: "司律備考｜AI 司律考試教練", template: "%s｜iBrain 備考" },
  description: "不同類科各自獨立的 AI 備考與線上測驗平台。",
  other: {
    "codex-preview": "development",
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-Hant">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
        <NavigationFeedback />
        <GlobalSelectionTools />
        <StudyBreakReminder />
      </body>
    </html>
  );
}
