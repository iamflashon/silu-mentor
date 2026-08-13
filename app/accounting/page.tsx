import type { Metadata } from "next";
import AccountingCoach from "./AccountingCoach";
export const metadata: Metadata = { title: "中級會計備考", description: "中級會計課業答疑、選擇題真題與申論解題平台。" };
export default function AccountingHome(){return <main className="accounting-home">
 <header className="accounting-top"><a href="/accounting" className="accounting-brand"><span>中</span><div><b>中級會計備考</b><small>INTERMEDIATE ACCOUNTING</small></div></a><nav><a className="active" href="/accounting">課業答疑</a><a href="/accounting/practice">練真題</a><a href="/accounting/essay">解申論</a><a href="/accounting/admin">管理後台</a><a href="/platform">切換類科</a></nav></header>
 <section className="accounting-hero accounting-help-hero"><div><span>中級會計學 · AI 課業答疑</span><h1>有哪裡不懂，<br/>直接問就好</h1><p>觀念、準則、計算、分錄或老師上課沒聽懂的地方，都能打字、貼截圖或拍照提問。不必先選書，也不必先選章節。</p><div><a href="#accounting-coach">開始問中會 AI</a><a href="/accounting/practice">練選擇題真題</a><a href="/accounting/essay">老師帶我解申論</a></div></div><aside><span>三個入口，各做一件事</span><ol><li><b>01</b>首頁：單純課業答疑</li><li><b>02</b>練真題：只練選擇題</li><li><b>03</b>解申論：挑題後由老師逐步帶解</li></ol></aside></section>
 <AccountingCoach />
 </main>}
