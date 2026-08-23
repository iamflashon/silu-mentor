import { headers } from "next/headers";
import { requireMedtechMember } from "../../lib/member-auth";
import MedtechHeaderActions from "./MedtechHeaderActions";
import MedtechPlanDialog from "./MedtechPlanDialog";
import LinePayPurchaseButton from "./LinePayPurchaseButton";
import { memberLoginPath } from "../../lib/member-login-path";
import { getDb } from "../../db";
import { getMedtechProductSettings } from "../../lib/medtech-product-settings";
import { getActiveMedtechAllAccess } from "../../lib/medtech-usage";
import { getMemberSession } from "../../lib/member-session-auth";
export const dynamic = "force-dynamic";
export default async function MedtechHome() {
  const requestHeaders = await headers();
  const memberRequest = new Request("https://medtech.local/medtech", { headers: requestHeaders });
  const [auth, memberSession] = await Promise.all([
    requireMedtechMember(memberRequest),
    getMemberSession(memberRequest),
  ]);
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
  const product = await getMedtechProductSettings(await getDb());
  const entitlement = memberSession ? await getActiveMedtechAllAccess(auth.db, auth.userKey) : null;
  const upcomingBooks = [
    { volume: "Ⅰ", title: "臨床血液學與血庫學（上）", cover: "/medtech-books/clinical-hematology-upper.jpg" },
    { volume: "Ⅰ", title: "臨床血液學與血庫學（下）", cover: "/medtech-books/clinical-hematology-lower.png" },
    { volume: "Ⅱ", title: "微生物學與臨床微生物學（上）", cover: "/medtech-books/clinical-microbiology-upper.jpg" },
    { volume: "Ⅱ", title: "微生物學與臨床微生物學（含黴菌）（下）", cover: "/medtech-books/clinical-microbiology-lower.png" },
    { volume: "Ⅲ", title: "臨床血清免疫學（上）", cover: "/medtech-books/clinical-serum-immunology-upper.png" },
    { volume: "Ⅳ", title: "生物化學與臨床生化學", cover: "/medtech-books/biochemistry-clinical-biochemistry.png" },
    { volume: "Ⅴ", title: "臨床生理學（上）", cover: "/medtech-books/clinical-physiology-upper.png" },
    { volume: "Ⅴ", title: "臨床病理學（下）", cover: "/medtech-books/clinical-pathology-lower.png" },
    { volume: "Ⅵ", title: "醫學分子檢驗學", cover: "/medtech-books/molecular-diagnostics.png" },
    { volume: "Ⅶ", title: "臨床鏡檢學（含寄生蟲學）", cover: "/medtech-books/clinical-microscopy-parasitology.png" },
  ];
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
        <MedtechHeaderActions
          accountLabel={memberSession ? "我的帳號" : "會員登入"}
          accountHref={memberSession ? "/medtech/account" : memberLoginPath("/medtech")}
        />
        <nav>
          <a href="/medtech" className="active">
            首頁
          </a>
          <a href="/medtech/random">隨機模考</a>
          <a href="/platform">切換類科</a>
        </nav>
      </header>
      <section className="medtech-library-hero">
        <div>
          <span>康情老師・醫檢國考系列</span>
          <h1>醫檢師國考題詳解</h1>
          <p>一本書就是一套完整的數位練習課程。先選書，再進入章節刷題、模考、錯題重練與老師解析。</p>
          <div className="medtech-library-stats"><b>目前開放 1 本</b><span>系列書單持續擴充</span><span>首次免費體驗 {product.trialQuestions} 題</span></div>
        </div>
      </section>

      <section className="medtech-featured-book" aria-labelledby="featured-book-title">
        <div className="medtech-book-cover-wrap">
          <img src="/medtech-books/clinical-virology-lower.jpg" alt="醫檢師國考題詳解（Ⅲ）臨床病毒學（下）書封" />
          <span>目前開放</span>
        </div>
        <div className="medtech-featured-copy">
          <span>第一本數位題庫</span>
          <h2 id="featured-book-title">醫檢師國考題詳解（Ⅲ）<br />臨床病毒學（下）</h2>
          <p className="medtech-book-author">陳連城・康情老師</p>
          <p>1,400+ 題｜每 30 題一個練習單元｜章節刷題、跨章節模考、全真模擬、錯題重練、完整解析與康情老師語音。</p>
          <div className="medtech-book-trial"><b>首次免費體驗 {product.trialQuestions} 題</b><span>任選一個練習單元，先完整體驗再決定是否開通。</span></div>
          <div className={`medtech-book-price${entitlement ? " purchased" : ""}`}><strong>{entitlement ? "已購買" : `NT$${product.effectivePrice}`}</strong><span>{entitlement ? `有效至 ${new Intl.DateTimeFormat("zh-TW", { dateStyle: "medium", timeZone: "Asia/Taipei" }).format(entitlement.availableUntil)}` : `開通本書全部內容 ${product.accessDays} 天`}<br />{entitlement ? "全庫通行證使用中" : "一次付清・不自動續訂"}</span></div>
          <div className="medtech-featured-actions" data-no-navigation-feedback>
            <a className="primary trial" href="/medtech/chapters">{entitlement ? "進入已購買課程" : `免費體驗 ${product.trialQuestions} 題`}</a>
            {!entitlement && (memberSession
              ? <LinePayPurchaseButton packageName="全庫通行證" packNumber={1} amount={product.effectivePrice} label={`LINE Pay NT$${product.effectivePrice} 開通本書`} />
              : <a className="primary" href={memberLoginPath("/medtech")}>登入後購買</a>)}
            <MedtechPlanDialog price={product.effectivePrice} accessDays={product.accessDays} trialQuestions={product.trialQuestions} />
          </div>
        </div>
      </section>

      <section className="medtech-series-preview">
        <div className="medtech-section-heading"><span>系列書單</span><h2>接下來會加入的醫檢國考科目</h2><p>以下先作為出版系列預告；尚未開放的書不會收費。</p></div>
        <div className="medtech-book-grid">
          {upcomingBooks.map((book) => (
            <article className="medtech-preview-book" key={`${book.volume}-${book.title}`}>
              {book.cover ? <img src={book.cover} alt={`醫檢師國考題詳解（${book.volume}）${book.title}書封`} /> : <div className="medtech-cover-placeholder"><small>醫檢師</small><b>國考題詳解</b><em>{book.volume}</em><span>{book.title}</span></div>}
              <div><span>醫檢師國考題詳解（{book.volume}）</span><h3>{book.title}</h3><p>陳連城・康情老師</p><b className="coming-soon">即將推出</b></div>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
