import type { Metadata } from "next";
import { headers } from "next/headers";
import { ensureAnglePediaBetaAccess } from "../../lib/anglepedia-beta-access";
import SimpleChatHome from "../simple-chat-home";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "AnglePedia 元照百科",
  description: "優先搜尋元照中央資料的 AI 對話入口",
};

export default async function AnglePediaPage() {
  const headerStore = await headers();
  const access = await ensureAnglePediaBetaAccess(new Request("https://anglepedia.local/anglepedia", { headers: headerStore }));
  const initialNotice = access.status === "pending"
    ? "AnglePedia 首批 10 名測試名額已滿，我們已替你登記申請，請等待管理員開通。"
    : access.status === "paused"
      ? "這個 AnglePedia 測試帳號目前尚未開通，請聯絡管理員。"
      : "";
  return (
    <SimpleChatHome
      brand="AnglePedia 元照百科"
      symbol="元"
      logoSrc="/anglepedia-logo.png"
      heroLogoSrc="/anglepedia-wordmark-transparent.png"
      greeting="法學百川，一搜盡覽"
      knowledgeScope="anglepedia"
      endpoint="/api/anglepedia-chat"
      initialNotice={initialNotice}
      accessBlocked={access.status === "pending" || access.status === "paused"}
    />
  );
}
