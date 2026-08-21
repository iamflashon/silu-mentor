import MedtechTabs from "../MedtechTabs";
import MedtechHeaderActions from "../MedtechHeaderActions";

const rules = [
  [
    "章節／隨機題目包",
    "NT$30／包",
    "任選一包 30 題免費體驗一次；完成前一關後，每包最多 2 次答題挑戰，每題 5 秒，另有一次轉轉樂，最高五折；每天再有一次 30 題終極挑戰，3 分鐘內全對可用優惠價 NT$3 購買；購買後 7 天內不限次數重做。",
  ],
  [
    "全真模擬 120 題包",
    "NT$60",
    "一次購買完整 120 題；購買後 7 天內不限次數重做。",
  ],
  [
    "解題內容",
    "題目包內含",
    "包含已整理的解題提示、選項比較、完整解析與康情老師語音。",
  ],
  [
    "即時 AI 追問",
    "暫停開放",
    "目前不販售點數或追問次數，避免產生未使用額度。",
  ],
];
const usageSteps = [
  [
    "先領取題目包",
    "任選一包免費／挑戰折扣",
    "每包 30 題；完成前一關後可挑戰隨機 10 題，每題 5 秒，每包最多 2 次，另可抽一次轉轉樂，頁面會顯示到期倒數。",
  ],
  ["先想再作答", "提示免費", "先按「給我提示」，選答案後才開放後續功能。"],
  [
    "比較與聽解析",
    "題目包內含",
    "比較選項、完整解析與康情老師語音都不再另外扣點。",
  ],
  ["保存學習成果", "自動保存", "保留作答時間、錯題、答對率與需要加強的觀念。"],
];

export default function MedtechPricingPage() {
  return (
    <main className="medtech-pricing-page">
      <header className="medtech-top" data-no-navigation-feedback>
        <a href="/medtech" className="medtech-brand">
          <span>醫</span>
          <div>
            <b>醫檢師備考</b>
            <small>PACKAGE GUIDE</small>
          </div>
        </a>
        <MedtechHeaderActions />
      </header>
      <MedtechTabs />
      <section className="medtech-pricing-head">
        <span>題目包直接購買</span>
        <h1>不用儲值點數，價格直接用新台幣顯示。</h1>
        <p>
          題目包直接以新台幣計價；任選一包免費初體驗，其餘每包
          NT$30。完成前一關後，下一包可挑戰隨機 10 題，每題限時 5 秒，每包最多 2
          次，並可抽一次限時轉轉樂，最高五折；每天另有一次 30 題終極挑戰，3
          分鐘內全對可用優惠價 NT$3 購買。
        </p>
      </section>
      <section className="medtech-pricing-card">
        <h2>題目包包含哪些內容？</h2>
        <div className="medtech-pricing-rules">
          {rules.map(([name, cost, description]) => (
            <article key={name}>
              <div>
                <b>{name}</b>
                <strong>{cost}</strong>
              </div>
              <p>{description}</p>
            </article>
          ))}
        </div>
        <div className="medtech-pricing-note">
          <b>闖關優惠怎麼玩？</b>
          <span>
            每包 30 題，購買後 7 天內不限次數重做；完成前一關後可挑戰隨機 10
            題，每題 5 秒，每包最多 2
            次，答對率與平均速度越好，折扣越優惠，兩次取最佳結果；另可抽一次轉轉樂，最高五折。每天還有一次
            30 題終極挑戰，題目與選項重新打亂，3 分鐘內全對即可用優惠價 NT$3
            購買下一關。全真模擬 120 題另有 NT$60 一次購足方案。
          </span>
        </div>
        <div className="medtech-pricing-actions">
          <a className="primary" href="/medtech/upgrade">
            查看題目包
          </a>
          <a href="/medtech/account">查看我的學習紀錄</a>
        </div>
      </section>
      <section className="medtech-usage-guide" aria-label="平台使用流程">
        <div>
          <span>整體使用流程</span>
          <h2>一題就照這四步走</h2>
          <p>先免費體驗學習方法，購買題目包後直接使用包內全部解題內容。</p>
        </div>
        <div className="medtech-usage-guide-grid">
          {usageSteps.map(([title, cost, description], index) => (
            <article key={title}>
              <b>0{index + 1}</b>
              <h3>{title}</h3>
              <strong>{cost}</strong>
              <p>{description}</p>
            </article>
          ))}
        </div>
        <p className="medtech-usage-guide-note">
          <b>目前服務範圍：</b>
          提供已整理的解題提示、選項比較、完整解析與老師語音；即時 AI
          自由追問暫停開放，不販售點數或追問次數。
        </p>
      </section>
      <p className="medtech-pricing-foot">
        不自動續訂、不綁月費；每次刷題都會保存開始時間、完成狀態、花費時間、答對率、錯題與需要加強的觀念。
      </p>
    </main>
  );
}
