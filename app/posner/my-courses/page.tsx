import Link from "next/link";

export default function PosnerMyCoursesPage() {
  return (
    <main className="posner-library-page">
      <span className="posner-section-label">MY LIBRARY</span>
      <h1>我的課程</h1>
      <p>登入後，已完成付款的課程會立即出現在這裡。</p>
      <section className="posner-library-empty">
        <div aria-hidden="true">P</div><h2>還沒有已購買的課程</h2>
        <p>回到影音讀書館，看看正在準備的課程。</p>
        <Link className="posner-primary" href="/posner#courses">探索影音課程</Link>
      </section>
    </main>
  );
}
