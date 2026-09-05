import type { Metadata } from "next";
import "../../study-room.css";

export const metadata: Metadata = { title: "學霸讀書室｜鄭泓中級會計" };

const modes = [
  ["重", "考試重點", "依《中級會計學霸》章節掌握核心觀念、公式與常考題型。", "/accounting/chapters", "選擇章節"],
  ["讀", "考前速讀", "把指定章節縮成考前可快速複習的觀念與計算步驟。", "/accounting/chapters?mode=review", "開始整理"],
  ["想", "主動回想", "一次完成一題再看解析，從選擇題練習真正記住觀念。", "/accounting/practice", "開始練題"],
  ["說", "教給我聽", "用自己的話說明會計處理，找出觀念、分錄或計算遺漏。", "/accounting/chapters?mode=teachback", "選擇章節"],
  ["補", "弱點分析", "從錯題與作答紀錄回到對應章節，再安排選擇題及申論補強。", "/accounting/practice?view=wrong", "查看弱點"],
] as const;

export default function AccountingStudyRoom(){return <main className="study-room">
  <header className="study-room-top"><a className="study-room-brand" href="/accounting"><span>鄭</span><div><b>學霸讀書室</b><small>ZHENG HONG · INTERMEDIATE ACCOUNTING</small></div></a><nav><a href="/accounting">返回書籍</a><a href="/accounting/qa">課業答疑</a></nav></header>
  <section className="study-room-head"><span>鄭泓老師 · 中級會計</span><h1>學霸讀書室</h1><p>把《中級會計學霸》上、下冊，選擇題庫與申論題庫串在一起。讀完觀念就練題，答錯再回到書中補強。</p></section>
  <div className="study-room-body">
    <section className="study-room-connect" aria-label="學習資料入口"><a href="/accounting/chapters"><b>《中級會計學霸》上、下冊</b><span>依 17 章閱讀核心教材，限定章節查找與複習。</span></a><a href="/accounting/practice"><b>選擇題庫</b><span>依章節、學校與年度練習，保留錯題與作答紀錄。</span></a><a href="/accounting/essay"><b>申論題庫</b><span>練習計算、分錄與完整步驟，對照老師解析。</span></a></section>
    <div className="study-room-section-head"><h2>今天想怎麼讀？</h2><p>先開放五種核心學習方式</p></div>
    <section className="study-room-modes">{modes.map(([icon,title,description,href,action])=><a className="study-mode" href={href} key={title}><i>{icon}</i><h3>{title}</h3><p>{description}</p><b>{action} →</b></a>)}</section>
    <section className="study-room-flow"><h2>同一個考點，三向連結</h2><ol><li>先從學霸上、下冊理解觀念與公式</li><li>用選擇題確認是否真的會判斷</li><li>用申論題練完整計算與分錄</li><li>答錯後回到書頁並安排補強</li></ol></section>
  </div>
</main>}
