import DocumentQuestionLibrary from "../DocumentQuestionLibrary";

export default function MedtechDocumentLibraryPage() {
  return <main className="medtech-admin-page">
    <header>
      <a href="/medtech" className="medtech-brand"><span>醫</span><div><b>醫檢師文件題庫</b><small>MEDTECH DOCUMENT LIBRARY</small></div></a>
      <nav><a href="/medtech/admin">管理後台</a><a href="/medtech/account">我的帳號</a></nav>
    </header>
    <section className="medtech-admin-hero"><div><span>醫檢師 · 獨立文件管理</span><h1>醫檢文件題庫</h1><p>此頁只顯示醫檢文件，不會進入跨類科總管理處。</p></div></section>
    <DocumentQuestionLibrary />
  </main>;
}
