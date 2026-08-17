import { headers } from "next/headers";
import { and, count, desc, eq, inArray, lt, sum } from "drizzle-orm";
import { chatGPTSignInPath, chatGPTSignOutPath } from "../../chatgpt-auth";
import { examQuestions, medtechPointLedger } from "../../../db/schema";
import { requireMedtechMember } from "../../../lib/member-auth";
import { getOrCreateMedtechUsage } from "../../../lib/medtech-usage";
import PointLedgerList from "./PointLedgerList";

export const dynamic = "force-dynamic";

type AccountPageProps = {
  searchParams?: Promise<{ page?: string | string[] }>;
};

export default async function MedtechAccountPage({ searchParams }: AccountPageProps) {
  const requestHeaders = await headers();
  const auth = await requireMedtechMember(new Request("https://account.local/medtech/account", { headers: requestHeaders }));
  if ("error" in auth) return <main className="medtech-member-page"><header><a href="/medtech" className="medtech-brand"><span>醫</span><div><b>醫檢師備考</b><small>MEMBER ACCESS</small></div></a></header><section className="medtech-member-card login"><span>醫檢師會員專區</span><h1>登入你的學習帳號</h1><p>登入後可保存作答紀錄、錯題、筆記與引導學習內容。若帳號尚未開通，請聯絡醫檢師管理員。</p><a className="primary" href={chatGPTSignInPath("/medtech/account")}>登入醫檢師備考</a><a href="/medtech">先回首頁</a></section></main>;
  const { member, access } = auth;
  const usage = await getOrCreateMedtechUsage(auth.db, member.email);
  const params = (await searchParams) ?? {};
  const rawPage = Array.isArray(params.page) ? params.page[0] : params.page;
  const requestedPage = Number.parseInt(rawPage ?? "1", 10);
  const pageSize = 10;
  const [{ total }] = await auth.db.select({ total: count() }).from(medtechPointLedger).where(eq(medtechPointLedger.userKey, member.email));
  const totalPages = Math.max(1, Math.ceil(Number(total) / pageSize));
  const page = Math.min(Math.max(Number.isFinite(requestedPage) ? requestedPage : 1, 1), totalPages);
  const [{ spentRaw }] = await auth.db.select({ spentRaw: sum(medtechPointLedger.delta) }).from(medtechPointLedger).where(and(eq(medtechPointLedger.userKey, member.email), lt(medtechPointLedger.delta, 0)));
  const spent = Math.abs(Number(spentRaw ?? 0));
  const history = await auth.db.select().from(medtechPointLedger).where(eq(medtechPointLedger.userKey, member.email)).orderBy(desc(medtechPointLedger.createdAt)).limit(pageSize).offset((page - 1) * pageSize);
  const questionIds = [...new Set(history.map((row) => row.questionId).filter((id): id is number => id !== null))];
  const questionSources = questionIds.length ? await auth.db.select({ id: examQuestions.id, year: examQuestions.year, questionNumber: examQuestions.questionNumber, subject: examQuestions.subject, stem: examQuestions.stem }).from(examQuestions).where(inArray(examQuestions.id, questionIds)) : [];
  const historyForClient = history.map((row) => ({ ...row, createdAt: row.createdAt.toISOString(), availableUntil: row.availableUntil?.toISOString() ?? null }));
  const pageHref = (nextPage: number) => `/medtech/account?page=${nextPage}`;
  return <main className="medtech-member-page"><header><a href="/medtech" className="medtech-brand"><span>醫</span><div><b>醫檢師備考</b><small>MY ACCOUNT</small></div></a></header><section className="medtech-member-card"><div className="identity"><span>{member.displayName.slice(0,1)}</span><div><small>醫檢師會員</small><h1>{member.displayName}</h1><p>{member.email}</p></div></div><div className="actions medtech-account-actions"><a className="primary" href="/medtech">進入學習首頁</a><a href="/medtech/upgrade">購買點數（測試付款）</a>{access.canAdmin && <a href="/medtech/admin">醫檢師管理後台</a>}<a href={chatGPTSignOutPath("/medtech")}>登出</a></div><dl><div><dt>類科資格</dt><dd>醫檢師 · 已開通</dd></div><div><dt>會員身分</dt><dd>{member.role === "teacher" ? "老師／導師" : "學員"}</dd></div><div><dt>班級</dt><dd>{access.className || "未分班"}</dd></div><div><dt>管理權限</dt><dd>{access.canAdmin ? "醫檢師管理員" : "一般會員"}</dd></div></dl><section className="medtech-point-summary"><div><small>目前可用點數</small><strong>{usage.aiCredits}<em> 點</em></strong><span>首次登入贈送 10 點</span></div><div><small>已使用點數</small><strong>{spent}<em> 點</em></strong><span>看題、語音解析與 AI 追問</span></div></section><section className="medtech-point-history"><header><div><small>點數明細</small><h2>使用狀況記錄</h2></div><span>第 {page}／{totalPages} 頁 · 共 {total} 筆</span></header>{history.length ? <PointLedgerList history={historyForClient} questionSources={questionSources} /> : <p>目前還沒有點數使用紀錄。</p>}<nav className="medtech-point-pagination" aria-label="點數紀錄分頁"><a className={page <= 1 ? "disabled" : ""} href={page > 1 ? pageHref(page - 1) : pageHref(1)} aria-disabled={page <= 1}>上一頁</a><span>第 {page}／{totalPages} 頁</span><a className={page >= totalPages ? "disabled" : ""} href={page < totalPages ? pageHref(page + 1) : pageHref(totalPages)} aria-disabled={page >= totalPages}>下一頁</a></nav></section></section></main>;
}
