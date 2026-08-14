import MedtechTabs from "./MedtechTabs";
import { getChatGPTUser } from "../chatgpt-auth";
export const dynamic = "force-dynamic";
export default async function MedtechHome() {
  const user = await getChatGPTUser();
  return <main className="medtech-home">
    <header className="medtech-top" data-no-navigation-feedback><a href="/medtech" className="medtech-brand"><span>醫</span><div><b>醫檢師備考</b><small>MEDICAL TECHNOLOGIST</small></div></a><a className="medtech-member-link" href="/medtech/account">{user ? "我的帳號" : "會員登入"}</a><nav><a href="/medtech" className="active">首頁</a><a href="/medtech/practice">練國考題</a><a href="/platform">切換類科</a></nav></header>
    <MedtechTabs active="random" />
    <section className="medtech-hero"><div><span>臨床病毒學 · 正式題庫</span><h1>為從事醫事檢驗（醫檢師）取得證照及入門基礎</h1><div className="medtech-hero-actions" data-no-navigation-feedback><a href="/medtech/practice">開始隨機 30 題</a><a href="/medtech/ai-study">進入引導學習</a></div></div><aside><small>已匯入正式題庫</small><b>1,493 <em>題</em></b><span>臨床病毒學</span></aside></section>
  </main>;
}
