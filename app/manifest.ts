import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "iBrain AI 考試顧問",
    short_name: "iBrain AI",
    description: "搜尋已授權高點學習資源，並由 AI 陪考教練延續每日進度。",
    start_url: "/law?mode=coach",
    scope: "/",
    display: "standalone",
    orientation: "portrait-primary",
    background_color: "#f2f6f9",
    theme_color: "#143b59",
    lang: "zh-Hant",
    categories: ["education", "productivity"],
    icons: [
      { src: "/favicon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      { src: "/favicon.svg", sizes: "any", type: "image/svg+xml", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "考試顧問", short_name: "找學習資源", url: "/law?mode=advisor" },
      { name: "陪考教練", short_name: "繼續今日進度", url: "/law?mode=coach" },
    ],
  };
}
