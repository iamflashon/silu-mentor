import type { Metadata } from "next";
import AccountingEssayCoach from "./AccountingEssayCoach";
export const metadata: Metadata={title:"解申論｜中級會計備考"};
export default function AccountingEssay(){return <main className="accounting-home"><header className="accounting-top"><a href="/accounting" className="accounting-brand"><span>中</span><div><b>中級會計備考</b><small>ESSAY COACH</small></div></a><nav><a href="/accounting">課業答疑</a><a href="/accounting/practice">練真題</a><a className="active" href="/accounting/essay">解申論</a><a href="/platform">切換類科</a></nav></header><AccountingEssayCoach/></main>}
