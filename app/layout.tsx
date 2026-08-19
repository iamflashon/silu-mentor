import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import "./plan/selection-tools.css";
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
  title: { default: "iBrain AI 學習平台", template: "%s｜iBrain AI 學習平台" },
  description: "iBrain 各類科獨立的 AI 學習與測驗平台。",
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
