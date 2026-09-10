import type { Metadata } from "next";
import SimpleChatHome from "../simple-chat-home";

export const metadata: Metadata = {
  title: "AnglePedia 元照百科",
  description: "優先搜尋元照中央資料的 AI 對話入口",
};

export default function AnglePediaPage() {
  return (
    <SimpleChatHome
      brand="AnglePedia 元照百科"
      symbol="元"
      logoSrc="/anglepedia-logo.png"
      greeting="想查什麼元照資料？"
      knowledgeScope="anglepedia"
    />
  );
}
