import MedtechTabs from "../MedtechTabs";
import MedtechHeaderActions from "../MedtechHeaderActions";
import LinePayPurchaseButton from "../LinePayPurchaseButton";
import { getDb } from "../../../db";
import { getMedtechProductSettings } from "../../../lib/medtech-product-settings";
import { headers } from "next/headers";
import { requireMedtechMember } from "../../../lib/member-auth";
import { getActiveMedtechAllAccess } from "../../../lib/medtech-usage";
import { createMedtechPurchaseProof } from "../../../lib/medtech-purchase-proof";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const features = [
  "1,400+ 題臨床病毒學題庫",
  "章節刷題、跨章節模考及全真模擬",
  "每 30 題一個練習單元，進度清楚",
  "錯題自動整理與重練",
  "判斷提示及四個選項比較",
  "完整解題解析",
  "康情老師語音解析",
  "方案開通期間不限次練習",
];

export default async function MedtechPricingPage() {
  const db = await getDb();
  const product = await getMedtechProductSettings(db);
  const requestHeaders = await headers();
  const auth = await requireMedtechMember(new Request("https://medtech.local/medtech/pricing", { headers: requestHeaders }));
  const entitlement = "error" in auth ? null : await getActiveMedtechAllAccess(auth.db, auth.userKey);
  const purchaseAuthorization = "error" in auth ? null : await createMedtechPurchaseProof(auth.member);
  const priceLabel = product.saleActive ? `活動價 NT$${product.effectivePrice}` : `NT$${product.effectivePrice}`;
  const dateLabel = (value: Date) => new Intl.DateTimeFormat("zh-TW", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Taipei" }).format(value);
  const remainingHours = entitlement ? Math.max(0, Math.ceil((entitlement.availableUntil.getTime() - Date.now()) / 3600000)) : 0;
  const remainingLabel = remainingHours >= 24 ? `剩餘 ${Math.floor(remainingHours / 24)} 天 ${remainingHours % 24} 小時` : `剩餘 ${remainingHours} 小時`;
  return (
    <main className="medtech-pricing-page">
      <header className="medtech-top" data-no-navigation-feedback>
        <a href="/medtech" className="medtech-brand">
          <span>醫</span>
          <div><b>醫檢師備考</b><small>ALL ACCESS</small></div>
        </a>
        <MedtechHeaderActions entitlement={entitlement ? {
          purchased: true,
          startedAt: entitlement.startedAt.toISOString(),
          availableUntil: entitlement.availableUntil.toISOString(),
        } : null} />
      </header>
      <MedtechTabs />
      <section className="medtech-pricing-head">
        <span>全庫通行證</span>
        <h1>{entitlement ? "你已購買本書，全庫通行證使用中。" : `一次付清 ${priceLabel}，完整使用 ${product.accessDays} 天。`}</h1>
        {entitlement ? (
          <div className="medtech-active-pass" role="status"><b>已購買・使用中</b><span>開通時間：{dateLabel(entitlement.startedAt)}</span><span>有效期限：{dateLabel(entitlement.availableUntil)}</span><strong>{remainingLabel}</strong></div>
        ) : <p>不再逐包收費。30 題仍作為學習進度單元；購買後全部章節、隨機模考、引導學習、解析與老師語音一次解鎖。</p>}
      </section>
      <section className="medtech-pricing-card">
        <h2>{priceLabel}／{product.accessDays} 天包含</h2>
        <div className="medtech-pricing-rules">
          {features.map((feature) => (
            <article key={feature}><div><b>{feature}</b><strong>已包含</strong></div></article>
          ))}
        </div>
        {!entitlement && <div className="medtech-pricing-note">
          <b>首次免費體驗 {product.trialQuestions} 題</b>
          <span>登入後可任選一個練習單元免費體驗；滿意後再一次開通全庫。免費體驗及正式通行證均保存進度、錯題與學習紀錄。</span>
        </div>}
        <div className="medtech-pricing-actions">
          {!entitlement && purchaseAuthorization && <LinePayPurchaseButton {...purchaseAuthorization} packageName="全庫通行證" packNumber={1} amount={product.effectivePrice} label={`LINE Pay NT$${product.effectivePrice} 開通 ${product.accessDays} 天`} />}
          <a href="/medtech/chapters">{entitlement ? "進入已購買課程" : `先免費體驗 ${product.trialQuestions} 題`}</a>
        </div>
      </section>
      <p className="medtech-pricing-foot">一次付清、不自動續訂；即時 AI 自由追問暫停開放，不影響已整理提示、選項比較、完整解析與康情老師語音。</p>
    </main>
  );
}
