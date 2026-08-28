import CentralAdminTabs from "../CentralAdminTabs";
import PengliBookMap from "../pengli-book-map/PengliBookMap";
import PengliQuestionAdmin from "../pengli-questions/PengliQuestionAdmin";
import "../pengli-book-map/pengli-book-map.css";
import "../pengli-questions/pengli-questions.css";
import "./teacher-materials.css";

export default async function Page({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const params = await searchParams;
  const view = params.view === "questions" ? "questions" : "alignment";
  return <main className="central-admin-page teacher-materials-page">
    <CentralAdminTabs active="teacher-materials"/>
    <section className="teacher-materials-head">
      <div><span>TEACHER MATERIALS</span><h1>老師教材管理</h1><p>先選老師與書籍，再處理書頁對照或學生疑問。</p></div>
      <div className="teacher-materials-selectors">
        <label>老師<select aria-label="選擇老師" defaultValue="pengli"><option value="pengli">彭狸老師</option></select></label>
        <label>教材<select aria-label="選擇教材" defaultValue="administrative-law"><option value="administrative-law">行政法考點演習書（二版）</option></select></label>
      </div>
    </section>
    <nav className="teacher-materials-views" aria-label="老師教材功能">
      <a className={view === "alignment" ? "active" : ""} href="/admin/teacher-materials?view=alignment"><span>01</span><div><b>書本與 PDF 對照</b><small>核對章節、印刷頁與 PDF 實際頁</small></div></a>
      <a className={view === "questions" ? "active" : ""} href="/admin/teacher-materials?view=questions"><span>02</span><div><b>學生疑問</b><small>檢視、確認並轉交老師回答</small></div></a>
    </nav>
    <section className="teacher-materials-content">
      {view === "alignment" ? <PengliBookMap/> : <><header className="teacher-question-title"><h2>學生疑問</h2><p>目前顯示彭狸老師這本教材所屬的學生疑問。</p></header><PengliQuestionAdmin/></>}
    </section>
  </main>;
}
