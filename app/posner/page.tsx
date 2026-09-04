import Link from "next/link";
import { and, desc, eq } from "drizzle-orm";
import { getDb } from "../../db";
import { learningResources, posnerCourseProducts } from "../../db/schema";

export const dynamic = "force-dynamic";

export default async function PosnerHome() {
  const db = await getDb();
  const courses = await db.select({
    id: learningResources.id,
    title: learningResources.title,
    subject: learningResources.subject,
    creator: learningResources.creator,
    description: learningResources.description,
    hasCover: learningResources.coverStorageKey,
    status: learningResources.status,
    price: posnerCourseProducts.price,
    accessDays: posnerCourseProducts.accessDays,
    salesEnabled: posnerCourseProducts.salesEnabled,
  }).from(learningResources)
    .leftJoin(posnerCourseProducts,eq(posnerCourseProducts.resourceId,learningResources.id))
    .where(and(eq(learningResources.resourceType, "course"), eq(learningResources.accessType, "posner"), eq(learningResources.status, "active")))
    .orderBy(desc(learningResources.createdAt))
    .limit(2);

  const featured = courses[0];
  const featuredTitle = featured?.title ?? "陳友心老師首波課程籌備中";
  const featuredCover = featured && /115高普考解題|政府會計/u.test(featured.title)
    ? "/posner/chen-youxin-115-government-accounting.png"
    : featured?.hasCover ? `/api/resources/cover?id=${featured.id}` : "";

  return (
    <main>
      <section className="posner-hero">
        <div className="posner-hero-copy">
          <span className="posner-kicker">BOOKSTORE · CAFE · CLASSROOM</span>
          <h1>好課如咖啡，<br />值得細品，也值得一再回味。</h1>
          <p>在一杯咖啡的時間裡學習，透過完整課程、重點摘要與時間軸，隨時回到值得細讀的一段。</p>
          <div className="posner-hero-actions">
            <Link className="posner-primary" href="#courses">瀏覽影音課程</Link>
            <Link className="posner-secondary" href="/posner/my-courses">前往我的課程</Link>
          </div>
        </div>
        <div className="posner-hero-card" aria-label="波斯納影音讀書館特色">
          <span>本週選課</span>
          <h2>{featuredTitle}</h2>
          <p>{featured?.creator ? `${featured.creator}老師` : "波斯納講師群"}</p>
          <div className="posner-card-line"><i />課程影片已完成本機安全轉檔</div>
          <div className="posner-card-line"><i />重點摘要可直接跳到時間點</div>
          <div className="posner-card-line"><i />LINE Pay 付款後立即開通</div>
        </div>
      </section>

      <section className="posner-reading-strip" aria-label="平台特色">
        <article><span>01</span><div><b>選一堂值得留下的課</b><p>從講師、主題與課程章節了解內容。</p></div></article>
        <article><span>02</span><div><b>付款後立即開始</b><p>完成 LINE Pay 後，課程直接加入帳號。</p></div></article>
        <article><span>03</span><div><b>用時間點快速複習</b><p>點擊重點摘要，直接跳到老師說明的位置。</p></div></article>
      </section>

      <section className="posner-course-section" id="courses">
        <header><div><span>VIDEO COURSES</span><h2>影音課程</h2></div><p>首批課程正在整理章節、字幕與重點摘要。</p></header>
        <div className="posner-course-grid">
          {featured ? (
            <Link className="posner-course-card" href={`/posner/course/${featured.id}`}>
              <div className={`posner-course-cover ${featuredCover ? "has-image" : ""}`} style={featuredCover ? { backgroundImage: `linear-gradient(180deg,rgba(25,35,44,.02),rgba(25,35,44,.3)),url(${featuredCover})` } : undefined}><span>{featured.subject}</span><strong>{featuredCover ? "" : <>POSNER<br />CLASS</>}</strong><small>{featured.creator || "陳友心"}</small></div>
              <div className="posner-course-info">
                <span>{featured.status === "active" ? "開放選購" : "內容準備中"}</span>
                <h3>{featuredTitle}</h3>
                <p>{featured.creator || "波斯納講師"} · 完整影音課程{featured.salesEnabled ? ` · NT$${featured.price}／${featured.accessDays} 天` : ""}</p>
                <div><b>查看課程內容</b><i aria-hidden="true">→</i></div>
              </div>
            </Link>
          ) : <div className="posner-empty">首波影音課程正在準備中。</div>}
          <article className="posner-coming-card">
            <span>COMING NEXT</span><h3>更多講座與讀書會</h3><p>未來會依主題整理成系列課程，保留每場對話最值得回看的部分。</p>
          </article>
        </div>
      </section>
    </main>
  );
}
