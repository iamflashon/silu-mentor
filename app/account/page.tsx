import { headers } from "next/headers";
import { requireMember } from "../../lib/member-auth";
import { memberLoginPath } from "../../lib/member-login-path";

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
  return <main className="account-page">
    <header className="standalone-page-head"><a href="/law" aria-label="回到司律備考首頁">← 回首頁</a></header>
    <section className="account-card">
      <div className="account-title"><span>{member.displayName.slice(0, 1)}</span><div><p>我的會員帳號</p><h1>{member.displayName}</h1><small>{member.email}</small></div></div>
      <div className="account-section"><h2>帳號資料</h2><dl className="account-details"><div><dt>登入帳號</dt><dd>{member.email}</dd></div><div><dt>學習身分</dt><dd>{roleLabel(member.role)}</dd></div><div><dt>班級</dt><dd>{member.className || "未分班"}</dd></div><div><dt>管理權限</dt><dd>{member.canAdmin ? "已啟用" : "一般會員"}</dd></div></dl></div>
      <div className="account-section"><div className="account-section-heading"><h2>會員服務</h2><small>功能規劃中</small></div><dl className="account-details account-future"><div><dt>會員資格</dt><dd>尚未啟用</dd></div><div><dt>訂閱方案</dt><dd>尚未啟用</dd></div><div><dt>可用點數</dt><dd>尚未啟用</dd></div></dl><p className="account-note">會員制度啟用後，會在這裡顯示真實資格、方案與點數；目前不使用示意數字。</p></div>
      <a className="account-signout" href="/api/member/logout?return_to=%2Flaw">登出此帳號</a>
    </section>
  </main>;
}
