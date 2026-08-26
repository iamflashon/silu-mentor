import type { Metadata } from "next";
import { headers } from "next/headers";
import { requireMember } from "../../lib/member-auth";
import { getAccountingProductSettings } from "../../lib/accounting-product-settings";
import "./books/page.css";

export const metadata: Metadata = {
  title: "中級會計練題館",
  description: "以書為單位進入中級會計選擇題與申論題練習，查看計算過程及老師解析。",
};
export const dynamic = "force-dynamic";

export default async function AccountingHome() {
  const auth = await requireMember(new Request("https://accounting.local/accounting", { headers: await headers() }));
  if ("error" in auth) return auth.error;
  const p = await getAccountingProductSettings(auth.db);

  return <main className="accounting-books-page">
    <header className="accounting-top">
      <a href="/accounting" className="accounting-brand"><span>中</span><div><b>中級會計練題館</b><small>BOOK PRACTICE</small></div></a>
      <nav><a className="active" href="/accounting">練題書庫</a></nav>
    </header>
    <section className="accounting-books-hero"><span>第一本書 · 選擇題訓練</span><h1>{p.title}</h1><p>{p.subtitle}</p></section>
    <article className="accounting-book-product">
      <div className="accounting-book-cover">{p.coverStorageKey?<img src="/api/accounting/product/cover" alt={`${p.title}書封`}/>:<div><span>中級會計學</span><b>題庫<br/>制霸</b><small>會研所選擇題庫</small></div>}</div>
      <div><small>會研所中級會計 · 章節題庫</small><h2>{p.title}</h2><div className="accounting-book-rich" dangerouslySetInnerHTML={{__html:p.descriptionHtml}}/><ul><li>依18章逐題練習</li><li>題幹、選項、計算過程與老師解析完整富文呈現</li><li>錯題重練、收藏與學習紀錄</li><li>購買日起使用 {p.accessDays} 天</li></ul></div>
      <aside><span>{p.saleActive&&<del>NT${p.listPrice}</del>} 單次購買</span><strong>NT${p.effectivePrice}</strong><b>{p.accessDays} 天</b><p>先免費體驗 {p.trialQuestions} 題<br/>不自動續約</p>{p.status==="active"?<button type="button" disabled>LINE Pay 購買（付款串接下一階段開放）</button>:<button type="button" disabled>{p.status==="draft"?"題庫整理中，尚未開放":"目前暫停販售"}</button>}<small>有效期內續購，會從原到期日接續延長，不會吃掉剩餘天數。</small></aside>
    </article>
    <section className="accounting-purchase-rules"><h2>購書與使用規則</h2><div><article><b>何時開始計算？</b><p>付款成功並開通後才開始計算，不從加入購物車或瀏覽日期起算。</p></article><article><b>90天內可以做什麼？</b><p>不限次練習已上架題目，可重做、查看解析、整理錯題與收藏。</p></article><article><b>續購會重算嗎？</b><p>不會。仍在有效期內續購，直接在原到期日之後增加當次方案天數。</p></article><article><b>AI包含在書內嗎？</b><p>書中既有解析不限次；AI追問與未來申論批改依AI方案另行計次。</p></article></div></section>
  </main>;
}
