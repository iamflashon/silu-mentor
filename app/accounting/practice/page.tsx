import type { Metadata } from "next";
export const metadata: Metadata = { title: "中會真題｜中級會計備考" };
export default function AccountingPractice() {
  return <main className="accounting-practice-page"><header className="accounting-top"><a href="/accounting" className="accounting-brand"><span>中</span><div><b>中級會計備考</b><small>MULTIPLE-CHOICE PRACTICE</small></div></a><nav><a href="/accounting">課業答疑</a><a className="active" href="/accounting/practice">練真題</a><a href="/accounting/essay">解申論</a><a href="/platform">切換類科</a></nav></header><section><span>中會選擇題真題</span><h1>練真題只練選擇題</h1><p>題目依年度與考試來源整理，作答後再逐項解析選項、計算關鍵與易錯觀念。書本與題庫只在背後提供答案依據，不要求學生依章節學習。</p><div><a href="/accounting/admin">前往管理後台檢查題庫</a><a href="/accounting/essay">前往解申論</a></div></section></main>;
}
