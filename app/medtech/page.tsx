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
  const auth = await requireMedtechMember(
    new Request("https://medtech.local/medtech", { headers: requestHeaders }),
  );
  if ("error" in auth)
    return (
      <main className="medtech-member-page">
        <header>
          <a href="/medtech" className="medtech-brand">
            <span>醫</span>
            <div>
              <b>醫檢師備考</b>
              <small>MEDICAL TECHNOLOGIST</small>
            </div>
          </a>
        </header>
        <section className="medtech-member-card login">
          <span>醫檢師備考平台</span>
          <h1>登入後開始學習</h1>
          <p>
            登入後才能進入章節刷題、隨機模考、錯題複習與引導學習，
            系統也會替你保存免費體驗、通行證與學習紀錄。
          </p>
          <a className="primary" href={memberLoginPath("/medtech")}>
            登入會員帳號
          </a>
        </section>
      </main>
    );
  const user = await getChatGPTUser();
  return (
    <main className="medtech-home">
      <header className="medtech-top" data-no-navigation-feedback>
        <a href="/medtech" className="medtech-brand">
          <span>醫</span>
          <div>
            <b>醫檢師備考</b>
            <small>MEDICAL TECHNOLOGIST</small>
          </div>
        </a>
        <MedtechHeaderActions accountLabel={user ? "我的帳號" : "會員登入"} />
        <nav>
          <a href="/medtech" className="active">
            首頁
          </a>
          <a href="/medtech/random">隨機模考</a>
          <a href="/platform">切換類科</a>
        </nav>
      </header>
      <MedtechTabs active="random" />
      <section className="medtech-hero">
        <div>
          <span>不只刷題｜把題目真正學會</span>
          <h1>不只刷題，而是讓老師帶你真正把題目學會</h1>
          <p className="medtech-hero-description">
            全真模擬試題 × 康情老師逐題語音解析 × 預先整理的解題引導
          </p>
          <p className="medtech-hero-offer">
            首次任選 30 題免費｜全庫通行證 NT$199／30 天｜不限次練習
          </p>
          <p className="medtech-hero-suboffer">
            一次付清、不自動續訂。30 題是清楚的學習進度單元，不再逐包計價；
            開通後可使用全部章節、跨章節模考、全真模擬、錯題重練與完整解析。
          </p>
          <div className="medtech-hero-actions" data-no-navigation-feedback>
            <MedtechPracticeEntry />
            <a href="/medtech/ai-study">進入引導學習</a>
            <a href="/medtech/pricing">查看 NT$199 全庫方案</a>
          </div>
        </div>
        <aside>
          <small>平台核心</small>
          <b>
            名師 <em>×</em> AI
          </b>
          <span>讓每一次作答都更接近學會</span>
          <dl>
            <div>
              <dt>免費入口</dt>
              <dd>任選 30 題</dd>
            </div>
            <div>
              <dt>完整題庫</dt>
              <dd>1,400+ 題</dd>
            </div>
            <div>
              <dt>深度解析</dt>
              <dd>老師語音</dd>
            </div>
            <div>
              <dt>持續進步</dt>
              <dd>學習紀錄</dd>
            </div>
          </dl>
        </aside>
      </section>
      <section className="medtech-home-message">
        <span>為什麼不只是題庫</span>
        <h2>刷題練習手感、老師語音解惑，AI 引導學會</h2>
        <p>
          答錯不只看到答案，而是知道為什麼錯、其他選項錯在哪，以及老師會怎麼教。
        </p>
      </section>
      <section className="medtech-home-values" aria-label="平台核心優勢">
        <article>
          <span>01 · 先思考</span>
          <h2>先給提示，再作答</h2>
          <p>預先整理的提示先讓你抓住關鍵、自己判斷，建立真正的理解。</p>
        </article>
        <article>
          <span>02 · 再理解</span>
          <h2>康情老師完整語音解析</h2>
          <p>用老師的口吻逐題說明正確理由與選項差異，已包含在全庫通行證內。</p>
        </article>
        <article>
          <span>03 · 持續學</span>
          <h2>依老師邏輯引導</h2>
          <p>
            判斷提示、四個選項比較與完整解析均包含；即時 AI 自由追問暫停開放。
          </p>
        </article>
        <article>
          <span>04 · 再鞏固</span>
          <h2>錯題複習鞏固</h2>
          <p>重新練習答錯的題目，確認真正學會，不讓錯題只停留在紀錄裡。</p>
        </article>
      </section>
      <section className="medtech-home-flow">
        <div>
          <span>一題的學習路徑</span>
          <h2>先想、再答、再比較，最後聽懂完整解析</h2>
        </div>
        <div className="medtech-home-flow-steps">
          <b>提示</b>
          <i>→</i>
          <b>作答</b>
          <i>→</i>
          <b>比較</b>
          <i>→</i>
          <b>老師語音</b>
        </div>
      </section>
      <section className="medtech-home-points">
        <div>
          <span>全庫通行證｜先體驗再決定</span>
          <h2>NT$199，一次開通完整 30 天</h2>
          <p>
            首次登入可任選一個 30 題單元免費體驗。開通後 30 天內可不限次使用
            1,400+ 題臨床病毒學題庫、章節刷題、跨章節模考、全真模擬、錯題重練、
            判斷提示、四個選項比較、完整解題解析與康情老師語音。30 題只作為進度單元，
            不再逐包收費；系統會持續保存刷題時間、答對率、錯題與需要加強的觀念。
          </p>
        </div>
        <a href="/medtech/pricing">查看全庫方案 →</a>
      </section>
      <section className="medtech-home-close">
        <strong>名師內容 × AI 引導 × 學習資料</strong>
        <span>免費題目是入口，深度解析才是價值。</span>
      </section>
    </main>
  );
}
