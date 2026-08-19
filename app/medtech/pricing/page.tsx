import MedtechTabs from "../MedtechTabs";
import MedtechHeaderActions from "../MedtechHeaderActions";

const rules = [
  ["章節／隨機題目包", "30 點／包", "任選一包 30 題免費體驗一次；完成前一關後，每包最多 2 次答題挑戰，每題 5 秒，另有一次轉轉樂，最高五折；每天再有一次 30 題終極挑戰，3 分鐘內全對可用 3 點解鎖；開通後 7 天內不限次數重做。"],
  ["康情老師語音完整解析", "1 點", "解鎖一次扣 1 點；同一題 24 小時內可無限重聽，超過期限再扣 1 點。"],
  ["AI 助教追問", "1 點", "每提出一個新問題扣 1 點。"],
  ["框選名詞解析", "前 3 次免費", "免費體驗用完後，每次扣 1 點。"],
  ["學習筆記", "前 5 筆免費", "第 6 筆起新增每筆扣 1 點；查看與編輯既有筆記不扣點。"],
];
const usageSteps = [
  ["先領取題目包", "任選一包免費／挑戰折扣", "每包 30 題；完成前一關後可挑戰隨機 10 題，每題 5 秒，每包最多 2 次，另可抽一次轉轉樂，頁面會顯示到期倒數。"],
  ["先想再作答", "提示免費", "先按「給我提示」，選答案後才開放後續功能。"],
  ["比較與聽解析", "語音 1 點／24 小時", "比較選項看簡答；康情老師語音 24 小時內可重聽不重扣。"],
  ["補充與整理", "追問 1 點／題", "想問 AI 助教時每個問題 1 點；框選專有名詞可看白話解釋。"],
];

export default function MedtechPricingPage() {
  return <main className="medtech-pricing-page">
    <header className="medtech-top" data-no-navigation-feedback>
      <a href="/medtech" className="medtech-brand"><span>醫</span><div><b>醫檢師備考</b><small>POINTS GUIDE</small></div></a>
      <MedtechHeaderActions activePoints />
    </header>
    <MedtechTabs />
    <section className="medtech-pricing-head">
      <span>簡單點數制</span>
      <h1>不用訂閱，按照使用方式扣點。</h1>
      <p>1 點＝NT$1。首次登入贈送 10 點；任選一包免費初體驗。完成前一關後，下一包可挑戰隨機 10 題，每題限時 5 秒，每包最多 2 次，並可抽一次限時轉轉樂，最高五折；每天另有一次 30 題終極挑戰，3 分鐘內全對可用 3 點解鎖。</p>
    </section>
    <section className="medtech-pricing-card">
      <h2>點數怎麼算？1 點＝NT$1</h2>
      <div className="medtech-pricing-rules">{rules.map(([name, cost, description]) => <article key={name}><div><b>{name}</b><strong>{cost}</strong></div><p>{description}</p></article>)}</div>
      <div className="medtech-pricing-note"><b>闖關優惠怎麼玩？</b><span>每包 30 題，開通後 7 天內不限次數重做；完成前一關後可挑戰隨機 10 題，每題 5 秒，每包最多 2 次，答對率與平均速度越好，折扣越優惠，兩次取最佳結果；另可抽一次轉轉樂，最高五折。每天還有一次 30 題終極挑戰，題目與選項重新打亂，3 分鐘內全對即可用 3 點解鎖下一關。全真模擬 120 題另有一次購足 60 點方案。</span></div>
      <div className="medtech-pricing-actions"><a className="primary" href="/medtech/upgrade">查看／購買點數</a><a href="/medtech/account">查看我的點數與紀錄</a></div>
    </section>
    <section className="medtech-usage-guide" aria-label="平台使用流程">
      <div><span>整體使用流程</span><h2>一題就照這四步走</h2><p>先免費體驗學習方法，再依真正需要的深度功能使用點數。</p></div>
      <div className="medtech-usage-guide-grid">{usageSteps.map(([title, cost, description], index) => <article key={title}><b>0{index + 1}</b><h3>{title}</h3><strong>{cost}</strong><p>{description}</p></article>)}</div>
      <p className="medtech-usage-guide-note"><b>框選專有名詞白話解釋：</b>在題幹、選項或解析中框選名詞，即可查看名詞類型、中文名稱、臨床用途與拆解重點；前 3 次免費體驗，之後每次扣 1 點。需要整理時，再加入我的筆記。每筆扣點紀錄都會顯示功能來源、題目與餘額；有使用期限的功能也會顯示倒數。</p>
    </section>
    <p className="medtech-pricing-foot">不自動續訂、不綁月費；每次刷題都會保存開始時間、完成狀態、花費時間、答對率、錯題與需要加強的觀念。</p>
  </main>;
}
