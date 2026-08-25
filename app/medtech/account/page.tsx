import { headers } from "next/headers";
import { desc, eq } from "drizzle-orm";
import { memberLoginPath } from "../../../lib/member-login-path";
import { examQuestions, medtechPracticeSessions } from "../../../db/schema";
import { hasMedtechPermission, requireMedtechMember } from "../../../lib/member-auth";
import { getActiveMedtechAllAccess } from "../../../lib/medtech-usage";
import MemberLogoutButton from "../MemberLogoutButton";
import DeleteMemberAccountButton from "../DeleteMemberAccountButton";

export const dynamic = "force-dynamic";

export default async function MedtechAccountPage() {
  const requestHeaders = await headers();
  const auth = await requireMedtechMember(
    new Request("https://account.local/medtech/account", {
      headers: requestHeaders,
    }),
  );
  if ("error" in auth)
    return (
      <main className="medtech-member-page">
        <header>
          <a href="/medtech" className="medtech-brand">
            <span>醫</span>
            <div>
              <b>醫檢師備考</b>
              <small>MEMBER ACCESS</small>
            </div>
          </a>
        </header>
        <section className="medtech-member-card login">
          <span>醫檢師會員專區</span>
          <h1>登入你的學習帳號</h1>
          <p>
            登入後可保存作答紀錄、錯題、筆記與引導學習內容。若帳號尚未開通，請聯絡醫檢師管理員。
          </p>
          <a className="primary" href={memberLoginPath("/medtech/account")}>
            登入會員帳號
          </a>
          <a href="/medtech">先回首頁</a>
        </section>
      </main>
    );
  if (!("access" in auth))
    return (
      <main className="medtech-member-page">
        <section className="medtech-member-card login">
          <h1>會員資料載入中</h1>
          <p>請重新整理頁面。</p>
        </section>
      </main>
    );
  const { member, access } = auth;
  const entitlement = await getActiveMedtechAllAccess(auth.db, member.email);
  const practiceSessions = await auth.db
    .select()
    .from(medtechPracticeSessions)
    .where(eq(medtechPracticeSessions.userKey, member.email))
    .orderBy(desc(medtechPracticeSessions.startedAt))
    .limit(100);
  const parseIds = (value: string) => {
    try {
      const parsed = JSON.parse(value || "[]") as unknown;
      return Array.isArray(parsed)
        ? parsed.filter((id): id is number => Number.isInteger(id) && id > 0)
        : [];
    } catch {
      return [];
    }
  };
  const parseWeaknesses = (value: string) => {
    try {
      const parsed = JSON.parse(value || "[]") as unknown;
      return Array.isArray(parsed)
        ? parsed.filter((item): item is { label: string; count: number } =>
            Boolean(
              item &&
                typeof item === "object" &&
                typeof (item as { label?: unknown }).label === "string" &&
                typeof (item as { count?: unknown }).count === "number",
            ),
          )
        : [];
    } catch {
      return [];
    }
  };
  const completedSessions = practiceSessions.filter(
    (session) => session.completedAt,
  );
  const totalAnswered = completedSessions.reduce(
    (sum, session) => sum + session.answeredQuestions,
    0,
  );
  const totalCorrect = completedSessions.reduce(
    (sum, session) => sum + session.correctQuestions,
    0,
  );
  const totalDurationSeconds = completedSessions.reduce(
    (sum, session) => sum + session.durationSeconds,
    0,
  );
  const wrongCounts = new Map<number, number>();
  const weaknessCounts = new Map<string, number>();
  for (const session of completedSessions) {
    for (const id of parseIds(session.incorrectQuestionIdsJson))
      wrongCounts.set(id, (wrongCounts.get(id) ?? 0) + 1);
    for (const weakness of parseWeaknesses(session.weaknessesJson))
      weaknessCounts.set(
        weakness.label,
        (weaknessCounts.get(weakness.label) ?? 0) + weakness.count,
      );
  }
  const topWrongId = [...wrongCounts.entries()].sort(
    (left, right) => right[1] - left[1],
  )[0]?.[0];
  const topWrongQuestion = topWrongId
    ? (
        await auth.db
          .select({
            id: examQuestions.id,
            year: examQuestions.year,
            questionNumber: examQuestions.questionNumber,
            subject: examQuestions.subject,
          })
          .from(examQuestions)
          .where(eq(examQuestions.id, topWrongId))
          .limit(1)
      )[0]
    : null;
  const topWeaknesses = [...weaknessCounts.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, 3);
  const lastSession = practiceSessions[0];
  const lastPracticeText = lastSession
    ? new Intl.DateTimeFormat("zh-TW", {
        dateStyle: "short",
        timeStyle: "short",
        timeZone: "Asia/Taipei",
      }).format(lastSession.startedAt)
    : "尚未開始刷題";
  const lastStatus = lastSession
    ? lastSession.completedAt
      ? "已完成"
      : "尚未完成"
    : "尚未開始";
  const accuracy = totalAnswered
    ? Math.round((totalCorrect / totalAnswered) * 100)
    : 0;
  const totalMinutes = Math.floor(totalDurationSeconds / 60);
  const accessDate = (value: Date) => new Intl.DateTimeFormat("zh-TW", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Taipei",
  }).format(value);
  const remainingHours = entitlement
    ? Math.max(0, Math.ceil((entitlement.availableUntil.getTime() - Date.now()) / 3600000))
    : 0;
  const remainingLabel = remainingHours >= 24
    ? `剩餘 ${Math.floor(remainingHours / 24)} 天 ${remainingHours % 24} 小時`
    : `剩餘 ${remainingHours} 小時`;
  return (
    <main className="medtech-member-page">
      <header>
        <a href="/medtech" className="medtech-brand">
          <span>醫</span>
          <div>
            <b>醫檢師備考</b>
            <small>MY ACCOUNT</small>
          </div>
        </a>
      </header>
      <section className="medtech-member-card">
        <div className="identity">
          <span>{member.displayName.slice(0, 1)}</span>
          <div>
            <small>醫檢師會員</small>
            <h1>{member.displayName}</h1>
            <p>{member.email}</p>
          </div>
        </div>
        <div className="actions medtech-account-actions">
          <a className="primary" href="/medtech">
            進入學習首頁
          </a>
          <a href={entitlement ? "/medtech/chapters" : "/medtech/upgrade"}>{entitlement ? "我已購買課程" : "選購題目包"}</a>
          {(access.canAdmin || hasMedtechPermission(access.permissionsJson, "questions")) && <a href="/medtech/admin">{access.canAdmin ? "醫檢師管理後台" : "文件題庫編修"}</a>}
          <MemberLogoutButton />
        </div>
        <dl>
          <div>
            <dt>類科資格</dt>
            <dd>
              {entitlement
                ? `本書已付費開通 · 至 ${new Intl.DateTimeFormat("zh-TW", { dateStyle: "medium", timeZone: "Asia/Taipei" }).format(entitlement.availableUntil)}`
                : "尚未購買 · 可任選一包免費體驗"}
            </dd>
          </div>
          <div>
            <dt>會員身分</dt>
            <dd>{member.role === "teacher" ? "老師／導師" : "學員"}</dd>
          </div>
          <div>
            <dt>班級</dt>
            <dd>{access.className || "未分班"}</dd>
          </div>
          <div>
            <dt>管理權限</dt>
            <dd>{access.canAdmin ? "醫檢師管理員" : hasMedtechPermission(access.permissionsJson, "questions") ? "文件題庫編修者" : "一般會員"}</dd>
          </div>
        </dl>
        {entitlement && (
          <section className="medtech-purchased-course" aria-label="我已購買課程">
            <header><small>我已購買課程</small><h2>醫檢師國考題詳解（Ⅲ）臨床病毒學（下）</h2></header>
            <dl>
              <div><dt>開通時間</dt><dd>{accessDate(entitlement.startedAt)}</dd></div>
              <div><dt>有效期限</dt><dd>{accessDate(entitlement.availableUntil)}</dd></div>
              <div><dt>目前狀態</dt><dd>使用中・{remainingLabel}</dd></div>
            </dl>
            <a className="primary" href="/medtech/chapters">進入已購買課程</a>
          </section>
        )}
        <section className="medtech-study-statistics">
          <header>
            <div>
              <small>刷題分析</small>
              <h2>每次練習都留下可追蹤結果</h2>
            </div>
            <span>
              {lastPracticeText} · {lastStatus}
            </span>
          </header>
          <div className="medtech-study-stat-grid">
            <div>
              <small>完成刷題次數</small>
              <strong>{completedSessions.length}</strong>
            </div>
            <div>
              <small>累計作答題數</small>
              <strong>{totalAnswered}</strong>
            </div>
            <div>
              <small>總花費時間</small>
              <strong>
                {totalMinutes}
                <em> 分</em>
              </strong>
            </div>
            <div>
              <small>答對率／錯題率</small>
              <strong>
                {accuracy}% <em>／ {totalAnswered ? 100 - accuracy : 0}%</em>
              </strong>
            </div>
          </div>
          {topWrongQuestion ? (
            <div className="medtech-study-weaknesses">
              <h3>最常答錯</h3>
              <ul>
                <li>
                  {topWrongQuestion.year} 年第 {topWrongQuestion.questionNumber}{" "}
                  題（{topWrongQuestion.subject}）共錯{" "}
                  {wrongCounts.get(topWrongQuestion.id)} 次。
                  <a
                    href={`/medtech/practice?wrongOnly=1&focus=${topWrongQuestion.id}`}
                  >
                    針對這題加強
                  </a>
                </li>
                {topWeaknesses.map(([label, count]) => (
                  <li key={label}>
                    需要加強觀念：{label}（{count} 題次）
                  </li>
                ))}
                <li>
                  建議學習包：先複習錯題，再聽康情老師語音完整解析；後續可延伸成「解題觀念微課語音包」。
                </li>
              </ul>
            </div>
          ) : (
            <p>
              完成一回題目包後，系統會分析最後刷題時間、完成狀態、作答時間、答對率、錯題率與需要加強的觀念。
            </p>
          )}
        </section>
        {!member.canAdmin && <DeleteMemberAccountButton email={member.email} />}
      </section>
    </main>
  );
}
