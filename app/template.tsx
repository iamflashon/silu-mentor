import { headers } from "next/headers";
import { chatGPTSignInPath, chatGPTSignOutPath, getChatGPTUser } from "./chatgpt-auth";
import { requireMember } from "../lib/member-auth";

export const dynamic = "force-dynamic";

export default async function IdentityGate({ children }:{ children:React.ReactNode }) {
  const requestHeaders = await headers();
  // Let the dedicated login route start ChatGPT authentication itself. Without
  // this exception the global identity gate replaces that route with a generic
  // card and loses the original return path.
  if (requestHeaders.get("x-silu-auth-route") === "1") return children;

  const user = await getChatGPTUser();
  if (!user) {
    return <main className="main-entry-gate"><section className="admin-login-card"><span>CHATGPT IDENTITY</span><div className="main-entry-logo" aria-hidden="true">智</div><h1>使用 ChatGPT 帳號登入</h1><p>本平台只接受 ChatGPT 身分驗證，不再提供公開註冊或密碼登入。</p><a className="main-entry-medtech" href={chatGPTSignInPath("/")}>使用 ChatGPT 登入</a></section></main>;
  }

  const auth = await requireMember(new Request("https://silu-mentor.invalid/", { headers: requestHeaders }));
  if ("error" in auth) {
    const cloudflareGoogle = user.provider === "cloudflare-google";
    return <main className="main-entry-gate"><section className="admin-login-card"><span>MEMBERSHIP REQUIRED</span><div className="main-entry-logo" aria-hidden="true">智</div><h1>此帳號尚未開通</h1><p>已確認{cloudflareGoogle ? " Google" : " ChatGPT"}帳號：<strong>{user.email}</strong></p><p>{cloudflareGoogle ? "Google" : "ChatGPT"} 登入只用來確認身分；平台教材、AI 次數與類科權限仍須由管理員開通。</p><a className="main-entry-medtech" href={cloudflareGoogle ? "/cdn-cgi/access/logout" : chatGPTSignOutPath("/")}>改用其他{cloudflareGoogle ? " Google" : " ChatGPT"}帳號</a></section></main>;
  }
  return children;
}
