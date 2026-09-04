import Link from "next/link";
import { and, asc, eq, gt } from "drizzle-orm";
import { notFound } from "next/navigation";
import { getDb } from "../../../../db";
import { learningResources, members, posnerCourseEntitlements, posnerCourseProducts, resourceSegments } from "../../../../db/schema";
import { getChatGPTUser } from "../../../chatgpt-auth";
import PosnerCourseAccess from "./PosnerCourseAccess";

export const dynamic = "force-dynamic";

function timeLabel(seconds: number | null) {
  const total = Math.max(0, seconds ?? 0);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}` : `${minutes}:${String(secs).padStart(2, "0")}`;
}

export default async function PosnerCoursePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const resourceId = Number(id);
  if (!Number.isInteger(resourceId)) notFound();
  const db = await getDb();
  const [course] = await db.select().from(learningResources).where(and(eq(learningResources.id, resourceId), eq(learningResources.resourceType, "course"))).limit(1);
  if (!course || course.accessType !== "posner" || course.status !== "active") notFound();
  const [product] = await db.select().from(posnerCourseProducts).where(eq(posnerCourseProducts.resourceId,resourceId)).limit(1);
  const user=await getChatGPTUser();let entitlement:null|{expiresAt:Date}=null;
  if(user){const [member]=await db.select({id:members.id}).from(members).where(eq(members.email,user.email)).limit(1);if(member)[entitlement]=await db.select({expiresAt:posnerCourseEntitlements.expiresAt}).from(posnerCourseEntitlements).where(and(eq(posnerCourseEntitlements.memberId,member.id),eq(posnerCourseEntitlements.resourceId,resourceId),eq(posnerCourseEntitlements.status,"active"),gt(posnerCourseEntitlements.expiresAt,new Date()))).limit(1)}
  const highlights = await db.select({ id: resourceSegments.id, title: resourceSegments.title, summary: resourceSegments.summary, startSeconds: resourceSegments.startSeconds })
    .from(resourceSegments)
    .where(and(eq(resourceSegments.resourceId, resourceId), eq(resourceSegments.segmentType, "subtitle")))
    .orderBy(asc(resourceSegments.sequence)).limit(8);
  const title = course.title;
  const coverUrl = /115高普考解題|政府會計/u.test(title)
    ? "/posner/chen-youxin-115-government-accounting.png"
    : course.coverStorageKey ? `/api/resources/cover?id=${course.id}` : "";

  return (
    <main className="posner-detail">
      <Link className="posner-back" href="/posner">← 回影音讀書館</Link>
      <section className="posner-detail-hero">
        <div className={`posner-detail-cover ${coverUrl ? "has-image" : ""}`} style={coverUrl ? { backgroundImage: `linear-gradient(180deg,rgba(25,35,44,.02),rgba(25,35,44,.3)),url(${coverUrl})` } : undefined}><span>{course.subject}</span><strong>{coverUrl ? "" : <>POSNER<br />CLASS</>}</strong><small>{course.creator || "陳友心"}</small></div>
        <div className="posner-detail-copy">
          <span>完整影音課程</span><h1>{title}</h1>
          <p>{course.creator || "波斯納講師"}老師</p>
          <div className="posner-course-note">{entitlement?`已開通，可觀看至 ${entitlement.expiresAt.toLocaleDateString("zh-TW")}`:product?.salesEnabled?`NT$${product.price}・開通 ${product.accessDays} 天・付款後立即觀看`:"目前提供精彩片段試看"}</div>
        </div>
      </section>

      {course.sourceUrl&&<PosnerCourseAccess courseId={course.id} title={course.title} sourceUrl={course.sourceUrl} owned={Boolean(entitlement)} expiresAt={entitlement?.expiresAt.toISOString()??null} price={product?.price??0} accessDays={product?.accessDays??365} previewStartSeconds={product?.previewStartSeconds??0} previewDurationSeconds={product?.previewDurationSeconds??300} salesEnabled={product?.salesEnabled??false} signedIn={Boolean(user)}/>}

      <section className="posner-detail-content">
        <div>
          <span className="posner-section-label">ABOUT THIS COURSE</span><h2>課程介紹</h2>
          <p>{course.description || "以完整影音保留老師的講解脈絡，搭配可跳轉的重點摘要，讓複習不必重新從頭尋找。"}</p>
          <h2>你會怎麼使用這堂課</h2>
          <ul><li>以 0.75～2 倍速觀看完整內容</li><li>從重點摘要直接跳至講解時間</li><li>離開後保留最近觀看位置</li><li>字幕完成後可搜尋課堂關鍵字</li></ul>
        </div>
        <aside className="posner-timeline-preview">
          <span>KEY MOMENTS</span><h2>重點時間軸</h2>
          {highlights.some((item) => item.summary.trim()) ? highlights.filter((item) => item.summary.trim()).slice(0, 5).map((item) => (
            <div key={item.id}><time>{timeLabel(item.startSeconds)}</time><p><b>{item.title || "課堂重點"}</b><span>{item.summary}</span></p></div>
          )) : <div className="posner-summary-pending"><b>本機字幕與摘要準備中</b><span>完成後，每個時間點都能直接跳轉播放。</span></div>}
        </aside>
      </section>
    </main>
  );
}
