import type { Metadata } from "next";
import AccountingPracticeClient from "./AccountingPracticeClient";
export const metadata: Metadata = { title: "中會真題｜中級會計課業答疑" };
export default function AccountingPractice(){return <main className="accounting-practice-page"><header className="accounting-top"><a href="/accounting" className="accounting-brand"><span>中</span><div><b>中級會計課業答疑</b><small>MULTIPLE-CHOICE PRACTICE</small></div></a><nav><a href="/accounting">課業答疑</a><a className="active" href="/accounting/practice">練真題</a><a href="/accounting/essay">解申論</a></nav></header><AccountingPracticeClient/></main>}
