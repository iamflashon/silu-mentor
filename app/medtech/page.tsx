import MedtechTabs from "./MedtechTabs";
import { getChatGPTUser } from "../chatgpt-auth";
import { headers } from "next/headers";
import { requireMedtechMember } from "../../lib/member-auth";
import MedtechHeaderActions from "./MedtechHeaderActions";
import MedtechPracticeEntry from "./MedtechPracticeEntry";
import { memberLoginPath } from "../../lib/member-login-path";
export const dynamic = "force-dynamic";
export default async function MedtechHome() {
    const requestHeaders = await headers();
  const auth = await requireMedtechMember(new Request("https://medtech.local/medtech", { headers: requestHeaders }));
  if ("error" in auth) return <main className="medtech-member-page"><header><a href="/medtech" className="medtech-brand"><span>醫</span><div><b>醫檢師備考</b><small>MEDICAL TECHNOLOGIST</small></div></a></header><section className="medtech-member-card login"><span>醫檢師備考平台</span><h1>登入後開始學習</h1><p>登入後才能進入章節刷題、隨機模考、錯題複習與 AI 引導學習，系統也會替你保存點數與學習紀錄。</p><a className="primary" href={memberLoginPath("/medtech")}>登入會員帳號</a></section></main>;
  const user = await getChatGPTUser();
  return <main className="medtech-home">
    <header className="medtech-top" data-no-navigation-feedback><a href="/medtech" className="medtech-brand"><span>醫</span><div><b>醫檢師備考</b><small>MEDICAL TECHNOLOGIST</small></div></a><MedtechHeaderActions accountLabel={user ? "我的帳號" : "會員登入"}/><nav><a href="/medtech" className="active">首頁</a><a href="/medtech/random">隨機模考</a><a href="/platform">切換類科</a></nav></header>
    <MedtechTabs active="random" />
    <section className="medtech-hero"><div><span>不只刷題｜把題目真正學會</span><h1>不只刷題，而是讓老師帶你真正把題目學會</h1><p className="medtech-hero-description">全真模擬試題 × 康情老師逐題語音解析 × AI 引導學習</p><p className="medtech-hero-offer">首次登入贈送 10 點｜任選一包 30 題免費｜答題挑戰每包最多兩次｜每日 1 折終極挑戰｜轉轉樂最高五折</p><p className="medtech-hero-suboffer">不用訂閱，依照使用方式簡單扣點；完成前一關後，可挑戰上一關隨機 10 題、參加一次限時轉轉樂，或每天挑戰一次 30 題終極挑戰。3 分鐘內全對可用 3 點解鎖下一關，題目與選項每次都會重新打亂。</p><div className="medtech-hero-actions" data-no-navigation-feedback><MedtechPracticeEntry/><a href="/medtech/ai-study">進入引導學習</a><a href="/medtech/pricing">查看點數方式</a></div></div><aside><small>平台核心</small><b>名師 <em>×</em> AI</b><span>讓每一次作答都更接近學會</span><dl><div><dt>免費入口</dt><dd>任選一包</dd></div><div><dt>闖關誘因</dt><dd>答題挑戰＋轉轉樂</dd></div><div><dt>深度解析</dt><dd>老師語音</dd></div><div><dt>持續進步</dt><dd>學習紀錄</dd></div></dl></aside></section>
    <section className="medtech-home-message"><span>為什麼不只是題庫</span><h2>刷題練習手感、老師語音解惑，AI 引導學會</h2><p>答錯不只看到答案，而是知道為什麼錯、其他選項錯在哪，以及老師會怎麼教。</p></section>
    <section className="medtech-home-values" aria-label="平台核心優勢">
      <article><span>01 · 先思考</span><h2>先給提示，再作答</h2><p>AI 不急著公布完整解析，先讓你抓住關鍵、自己判斷，建立真正的理解。</p></article>
      <article><span>02 · 再理解</span><h2>康情老師完整語音解析</h2><p>用老師的口吻逐題說明正確理由與選項差異，深度解析每次使用 1 點。</p></article>
      <article><span>03 · 持續學</span><h2>AI 依老師邏輯引導</h2><p>提示與比較免費；想繼續追問，每題 1 點，點數與學習紀錄完整保存。</p></article>
      <article><span>04 · 再鞏固</span><h2>錯題複習鞏固</h2><p>重新練習答錯的題目，確認真正學會，不讓錯題只停留在紀錄裡。</p></article>
    </section>
    <section className="medtech-home-flow"><div><span>一題的學習路徑</span><h2>先想、再答、再比較，最後聽懂完整解析</h2></div><div className="medtech-home-flow-steps"><b>提示</b><i>→</i><b>作答</b><i>→</i><b>比較</b><i>→</i><b>老師語音</b></div></section>
    <section className="medtech-home-points"><div><span>題目包制｜先體驗再決定</span><h2>便宜刷題，想再刷再購買</h2><p>首次登入贈 10 點；任選一包 30 題免費，使用一次後其他題目包以 30 點開通，7 天內不限次數重做。完成前一關後，每包最多可挑戰兩次，每次隨機 10 題、每題 5 秒，依答對率與平均速度計算折扣，兩次取最佳結果；另有一次限時轉轉樂，最高五折；每天再有一次 30 題終極挑戰，3 分鐘內全對即可用 3 點解鎖下一關。系統會提醒到期日，並保存刷題時間、答對率、錯題與需要加強的觀念；語音解析 1 點／24 小時，AI 追問 1 點。</p></div><a href="/medtech/pricing">查看題目包方式 →</a></section>
    <section className="medtech-home-close"><strong>名師內容 × AI 引導 × 學習資料</strong><span>免費題目是入口，深度解析才是價值。</span></section>
  </main>;
}
