import type { Metadata } from "next";
export const metadata: Metadata = { title: "中會真題｜中級會計備考" };
export default function AccountingPractice() {
  return <main className="accounting-practice-page"><header className="accounting-top"><a href="/accounting" className="accounting-brand"><span>中</span><div><b>中級會計備考</b><small>QUESTION BANK</small></div></a><nav><a href="/accounting">首頁</a><a className="active" href="/accounting/practice">練題庫</a><a href="/platform">切換類科</a></nav></header><section><span>中會題庫練習</span><h1>正在準備真實題庫</h1><p>將從《會研所中級會計學題庫制霸》依 18 章拆題，保留題目、題源與解答；沒有完成解析的題目不會先放上線，也不使用示範假資料。</p><div><a href="/admin">前往管理後台檢查匯入</a><a href="/accounting">回中會首頁</a></div></section></main>;
}
