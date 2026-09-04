import Link from "next/link";
import { and, desc, eq, gt } from "drizzle-orm";
import { requireChatGPTUser } from "../../chatgpt-auth";
import { getDb } from "../../../db";
import { learningResources, members, posnerCourseEntitlements } from "../../../db/schema";

export const dynamic="force-dynamic";
export default async function PosnerMyCoursesPage() {
  const user=await requireChatGPTUser("/posner/my-courses"),db=await getDb();
  const [member]=await db.select({id:members.id}).from(members).where(eq(members.email,user.email)).limit(1);
  const courses=member?await db.select({id:learningResources.id,title:learningResources.title,creator:learningResources.creator,subject:learningResources.subject,expiresAt:posnerCourseEntitlements.expiresAt}).from(posnerCourseEntitlements).innerJoin(learningResources,eq(learningResources.id,posnerCourseEntitlements.resourceId)).where(and(eq(posnerCourseEntitlements.memberId,member.id),eq(posnerCourseEntitlements.status,"active"),gt(posnerCourseEntitlements.expiresAt,new Date()))).orderBy(desc(posnerCourseEntitlements.updatedAt)):[];
  return (
    <main className="posner-library-page">
      <span className="posner-section-label">MY LIBRARY</span>
      <h1>我的課程</h1>
      <p>登入後，已完成付款的課程會立即出現在這裡。</p>
      {courses.length?<section className="posner-library-grid">{courses.map(course=><Link href={`/posner/course/${course.id}`} key={course.id}><span>{course.subject}</span><h2>{course.title}</h2><p>{course.creator}老師</p><small>可觀看至 {course.expiresAt.toLocaleDateString("zh-TW")}</small><b>繼續觀看 →</b></Link>)}</section>:<section className="posner-library-empty">
        <div aria-hidden="true">P</div><h2>還沒有已購買的課程</h2>
        <p>回到影音讀書館，看看正在準備的課程。</p>
        <Link className="posner-primary" href="/posner#courses">探索影音課程</Link>
      </section>}
    </main>
  );
}
