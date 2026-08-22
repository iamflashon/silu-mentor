import QuestionBank from "../QuestionBank";

export const dynamic = "force-dynamic";

export default function MedtechQuestionBankPage() {
  return (
    <main className="medtech-admin-page">
      <header>
        <a href="/medtech/admin" className="medtech-brand">
          <span>醫</span>
          <div><b>醫檢師管理後台</b><small>MEDTECH ADMIN</small></div>
        </a>
        <nav><a href="/medtech/admin?tab=questions">返回文件題庫</a><a href="/medtech">學生首頁</a></nav>
      </header>
      <section className="medtech-admin-hero">
        <div><span>醫檢師・獨立資料管理</span><h1>醫檢題庫總覽</h1><p>集中搜尋、篩選與編輯已發布的醫檢師題目。</p></div>
      </section>
      <QuestionBank />
    </main>
  );
}