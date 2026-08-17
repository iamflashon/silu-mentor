import MedtechTabs from "./MedtechTabs";
import { getChatGPTUser } from "../chatgpt-auth";
import { headers } from "next/headers";
import { requireMedtechMember } from "../../lib/member-auth";
import MedtechHeaderActions from "./MedtechHeaderActions";
export const dynamic = "force-dynamic";
export default async function MedtechHome() {
  const requestHeaders = await headers();
  await requireMedtechMember(new Request("https://medtech.local/medtech", { headers: requestHeaders }));
  const user = await getChatGPTUser();
  return <main className="medtech-home">
    <header className="medtech-top" data-no-navigation-feedback><a href="/medtech" className="medtech-brand"><span>醫</span><div><b>醫檢師備考</b><small>MEDICAL TECHNOLOGIST</small></div></a><MedtechHeaderActions accountLabel={user ? "我的帳號" : "會員登入"}/><nav><a href="/medtech" className="active">首頁</a><a href="/medtech/practice">練國考題</a><a href="/platform">切換類科</a></nav></header>
    <MedtechTabs active="random" />
    <section className="medtech-hero"><div><span>不只刷題｜把題目真正學會</span><h1>不只刷題，而是讓老師帶你真正把題目學會</h1><p className="medtech-hero-description">全真模擬試題 × 康情老師逐題語音解析 × AI 引導學習</p><p className="medtech-hero-offer">首次登入贈送 10 點｜不用訂閱，按照使用方式簡單扣點</p><div className="medtech-hero-actions" data-no-navigation-feedback><a href="/medtech/practice">開始免費練題</a><a href="/medtech/ai-study">進入引導學習</a><a href="/medtech/pricing">查看點數方式</a></div></div><aside><small>平台核心</small><b>名師 <em>×</em> AI</b><span>讓每一次作答都更接近學會</span><dl><div><dt>免費入口</dt><dd>全真題目</dd></div><div><dt>深度解析</dt><dd>老師語音</dd></div><div><dt>持續進步</dt><dd>學習紀錄</dd></div></dl></aside></section>
    <section className="medtech-home-message"><span>為什麼不只是題庫</span><h2>題目讓你進來；老師語音讓你留下來；AI 引導讓你真的會。</h2><p>答錯不只看到答案，而是知道為什麼錯、其他選項錯在哪，以及老師會怎麼教。</p></section>
    <section className="medtech-home-values" aria-label="平台核心優勢">
      <article><span>01 · 先思考</span><h2>先給提示，再作答</h2><p>AI 不急著公布完整解析，先讓你抓住關鍵、自己判斷，建立真正的理解。</p></article>
      <article><span>02 · 再理解</span><h2>康情老師完整語音解析</h2><p>用老師的口吻逐題說明正確理由與選項差異，深度解析每次使用 1 點。</p></article>
      <article><span>03 · 持續學</span><h2>AI 依老師邏輯引導</h2><p>提示與比較免費；想繼續追問，每題 1 點，點數與學習紀錄完整保存。</p></article>
    </section>
    <section className="medtech-home-flow"><div><span>一題的學習路徑</span><h2>先想、再答、再比較，最後聽懂完整解析</h2></div><div className="medtech-home-flow-steps"><b>提示</b><i>→</i><b>作答</b><i>→</i><b>比較</b><i>→</i><b>老師語音</b></div></section>
    <section className="medtech-home-points"><div><span>點數制｜單純透明</span><h2>用多少，扣多少</h2><p>首次登入贈 10 點；看一題 1 點，同一題 7 天內可無限重做；語音解析 1 點，同一題 24 小時內可無限重聽；AI 追問 1 點。120 題全刷只要 60 點，五折優惠。</p></div><a href="/medtech/pricing">查看點數方式 →</a></section>
    <section className="medtech-home-close"><strong>名師內容 × AI 引導 × 學習資料</strong><span>免費題目是入口，深度解析才是價值。</span></section>
  </main>;
}
