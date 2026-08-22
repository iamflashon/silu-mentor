import { headers } from "next/headers";
import { desc, eq } from "drizzle-orm";
import { memberLoginPath } from "../../../lib/member-login-path";
import { examQuestions, medtechPracticeSessions } from "../../../db/schema";
import { requireMedtechMember } from "../../../lib/member-auth";
import MemberLogoutButton from "../MemberLogoutButton";

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
          <a href="/medtech/upgrade">選購題目包</a>
          {access.canAdmin && <a href="/medtech/admin">醫檢師管理後台</a>}
          <MemberLogoutButton />
        </div>
        <dl>
          <div>
            <dt>類科資格</dt>
            <dd>醫檢師 · 已開通</dd>
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
            <dd>{access.canAdmin ? "醫檢師管理員" : "一般會員"}</dd>
          </div>
        </dl>
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
      </section>
    </main>
  );
}
