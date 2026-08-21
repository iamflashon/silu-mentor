import MedtechTabs from "../MedtechTabs";
import MedtechHeaderActions from "../MedtechHeaderActions";
import LinePayPurchaseButton from "../LinePayPurchaseButton";

const features = [
  "1,400+ 題臨床病毒學題庫",
  "章節刷題、跨章節模考及全真模擬",
  "每 30 題一個練習單元，進度清楚",
  "錯題自動整理與重練",
  "判斷提示及四個選項比較",
  "完整解題解析",
  "康情老師語音解析",
  "30 天不限次練習",
];

export default function MedtechPricingPage() {
  return (
    <main className="medtech-pricing-page">
      <header className="medtech-top" data-no-navigation-feedback>
        <a href="/medtech" className="medtech-brand">
          <span>醫</span>
          <div><b>醫檢師備考</b><small>ALL ACCESS</small></div>
        </a>
        <MedtechHeaderActions />
      </header>
      <MedtechTabs />
      <section className="medtech-pricing-head">
        <span>全庫通行證</span>
        <h1>一次付清 NT$199，完整使用 30 天。</h1>
        <p>不再逐包收費。30 題仍作為學習進度單元；購買後全部章節、隨機模考、引導學習、解析與老師語音一次解鎖。</p>
      </section>
      <section className="medtech-pricing-card">
        <h2>NT$199／30 天包含</h2>
        <div className="medtech-pricing-rules">
          {features.map((feature) => (
            <article key={feature}><div><b>{feature}</b><strong>已包含</strong></div></article>
          ))}
        </div>
        <div className="medtech-pricing-note">
          <b>首次免費體驗 30 題</b>
          <span>登入後可任選一個 30 題單元免費體驗；滿意後再一次開通全庫。免費體驗及正式通行證均保存進度、錯題與學習紀錄。</span>
        </div>
        <div className="medtech-pricing-actions">
          <LinePayPurchaseButton packageName="全庫通行證" packNumber={1} amount={199} label="LINE Pay NT$199 開通 30 天" />
          <a href="/medtech/chapters">先免費體驗 30 題</a>
        </div>
      </section>
      <p className="medtech-pricing-foot">一次付清、不自動續訂；即時 AI 自由追問暫停開放，不影響已整理提示、選項比較、完整解析與康情老師語音。</p>
    </main>
  );
}
