import type { Metadata, Viewport } from "next";
import "./globals.css";
import "./entry-gate.css";
import "./plan/selection-tools.css";
import GlobalSelectionTools from "./global-selection-tools";
import StudyBreakReminder from "./study-break-reminder";
import NavigationFeedback from "./navigation-feedback";
import SimulationToolsVisibility from "./simulation-tools-visibility";
import FrontendCostVisibility from "./frontend-cost-visibility";
import SpecialtyHomeLink from "./specialty-home-link";

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
      <body className="antialiased">
        <SimulationToolsVisibility />
        <FrontendCostVisibility />
        <SpecialtyHomeLink />
        {children}
        <NavigationFeedback />
        <GlobalSelectionTools />
        <StudyBreakReminder />
      </body>
    </html>
  );
}
