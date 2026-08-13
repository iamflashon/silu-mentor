import type { Metadata } from "next";
import AccountingCoach from "./AccountingCoach";
export const metadata: Metadata = { title: "中級會計課業答疑", description: "由 Luna 助教協助說明中級會計觀念、準則、計算與分錄。" };
export default function AccountingHome(){return <main className="accounting-home">
 <header className="accounting-top"><a href="/accounting" className="accounting-brand"><span>中</span><div><b>中級會計課業答疑</b><small>INTERMEDIATE ACCOUNTING</small></div></a><nav><a className="active" href="/accounting">課業答疑</a><a href="/accounting/admin">管理後台</a></nav></header>
 <section className="accounting-hero accounting-help-hero"><div><span>中級會計學 · Luna 助教</span><h1>有哪裡不懂，<br/>直接問就好</h1><p>觀念、準則、計算、分錄或老師上課沒聽懂的地方，都能打字、貼截圖或拍照提問。不必先選書，也不必先選章節。</p><div><a href="#accounting-coach">開始問 Luna 助教</a></div></div></section>
 <AccountingCoach />
 </main>}
