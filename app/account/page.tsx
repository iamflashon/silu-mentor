import { headers } from "next/headers";
import { and, eq } from "drizzle-orm";
import { pengliTeacherQuestions } from "../../db/schema";
import { requireMember } from "../../lib/member-auth";
import { memberLoginPath } from "../../lib/member-login-path";
import AiAccessPanel from "./AiAccessPanel";

function roleLabel(role: string) {
  return role === "teacher" ? "教師" : "學員";
}

export default async function AccountPage() {
  const headerStore = await headers();
  const request = new Request("https://account.local/account", { headers: headerStore });
  const auth = await requireMember(request);

  if ("error" in auth) {
    return <main className="account-page"><header className="standalone-page-head"><a href="/law" aria-label="回到司律備考首頁">← 回首頁</a></header><section className="account-card account-login"><h1>我的會員帳號</h1><p>請先登入，才能查看自己的會員資料。</p><a href={memberLoginPath("/account")}>登入我的學習平台</a></section></main>;
  }

  const { member } = auth;
  const teacherQuestions = member.role === "teacher" ? await auth.db.select({ id: pengliTeacherQuestions.id }).from(pengliTeacherQuestions)
    .where(and(eq(pengliTeacherQuestions.assignedTeacherId, member.id), eq(pengliTeacherQuestions.status, "pending_teacher"))).limit(200) : [];
  return <main className="account-page">
    <header className="standalone-page-head"><a href="/law" aria-label="回到司律備考首頁">← 回首頁</a></header>
    <section className="account-card">
      <div className="account-title"><span>{member.displayName.slice(0, 1)}</span><div><p>我的會員帳號</p><h1>{member.displayName}</h1><small>{member.email}</small></div></div>
      <div className="account-section"><h2>帳號資料</h2><dl className="account-details"><div><dt>登入帳號</dt><dd>{member.email}</dd></div><div><dt>學習身分</dt><dd>{roleLabel(member.role)}</dd></div><div><dt>班級</dt><dd>{member.className || "未分班"}</dd></div><div><dt>管理權限</dt><dd>{member.canAdmin ? "已啟用" : "一般會員"}</dd></div></dl></div>
      {member.role === "teacher" && <div className="account-section"><div className="account-section-heading"><div><h2>彭狸學生疑問</h2><small>只顯示管理員確認後指定給你的問題</small></div></div><a className="account-teacher-inbox-link" href="/teachers/pengli/teacher-inbox">我的待回答 <b>{teacherQuestions.length}</b></a></div>}
      <AiAccessPanel />
      <a className="account-signout" href="/api/member/logout?return_to=%2Flaw">登出此帳號</a>
    </section>
  </main>;
}
