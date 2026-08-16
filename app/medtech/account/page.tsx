import { headers } from "next/headers";
import { desc, eq } from "drizzle-orm";
import { chatGPTSignInPath, chatGPTSignOutPath } from "../../chatgpt-auth";
import { medtechPointLedger } from "../../../db/schema";
import { requireMedtechMember } from "../../../lib/member-auth";
import { getOrCreateMedtechUsage } from "../../../lib/medtech-usage";

export const dynamic = "force-dynamic";

export default async function MedtechAccountPage() {
  const requestHeaders = await headers();
  const auth = await requireMedtechMember(new Request("https://account.local/medtech/account", { headers: requestHeaders }));
  if ("error" in auth) return <main className="medtech-member-page"><header><a href="/medtech" className="medtech-brand"><span>醫</span><div><b>醫檢師備考</b><small>MEMBER ACCESS</small></div></a></header><section className="medtech-member-card login"><span>醫檢師會員專區</span><h1>登入你的學習帳號</h1><p>登入後可保存作答紀錄、錯題、筆記與引導學習內容。若帳號尚未開通，請聯絡醫檢師管理員。</p><a className="primary" href={chatGPTSignInPath("/medtech/account")}>登入醫檢師備考</a><a href="/medtech">先回首頁</a></section></main>;
  const { member, access } = auth;
  const usage = await getOrCreateMedtechUsage(auth.db, member.email);
  const history = await auth.db.select().from(medtechPointLedger).where(eq(medtechPointLedger.userKey, member.email)).orderBy(desc(medtechPointLedger.createdAt)).limit(30);
  const spent = history.filter((row) => row.delta < 0).reduce((total, row) => total + Math.abs(row.delta), 0);
  return <main className="medtech-member-page"><header><a href="/medtech" className="medtech-brand"><span>醫</span><div><b>醫檢師備考</b><small>MY ACCOUNT</small></div></a></header><section className="medtech-member-card"><div className="identity"><span>{member.displayName.slice(0,1)}</span><div><small>醫檢師會員</small><h1>{member.displayName}</h1><p>{member.email}</p></div></div><dl><div><dt>類科資格</dt><dd>醫檢師 · 已開通</dd></div><div><dt>會員身分</dt><dd>{member.role === "teacher" ? "老師／導師" : "學員"}</dd></div><div><dt>班級</dt><dd>{access.className || "未分班"}</dd></div><div><dt>管理權限</dt><dd>{access.canAdmin ? "醫檢師管理員" : "一般會員"}</dd></div></dl><section className="medtech-point-summary"><div><small>目前可用點數</small><strong>{usage.aiCredits}<em> 點</em></strong><span>首次登入贈送 10 點</span></div><div><small>已使用點數</small><strong>{spent}<em> 點</em></strong><span>完整解析、語音與 AI 追問</span></div></section><section className="medtech-point-history"><header><div><small>點數明細</small><h2>使用狀況記錄</h2></div><span>最近 {history.length} 筆</span></header>{history.length ? <div className="medtech-point-history-list">{history.map((row) => <article key={row.id}><div><b>{row.description}</b><small>{row.createdAt.toLocaleString("zh-TW", { dateStyle: "short", timeStyle: "short" })}</small></div><strong className={row.delta > 0 ? "plus" : "minus"}>{row.delta > 0 ? "+" : ""}{row.delta} 點</strong><span>餘額 {row.balanceAfter} 點</span></article>)}</div> : <p>目前還沒有點數使用紀錄。</p>}</section><div className="actions"><a className="primary" href="/medtech">進入學習首頁</a><a href="/medtech/upgrade">購買點數（測試付款）</a>{access.canAdmin && <a href="/medtech/admin">醫檢管理後台</a>}<a href={chatGPTSignOutPath("/medtech")}>登出</a></div></section></main>;
}
