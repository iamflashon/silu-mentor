import Link from "next/link";
import { headers } from "next/headers";
import { requireAdmin } from "../../lib/member-auth";

export const dynamic = "force-dynamic";

export default async function AdminLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const auth = await requireAdmin(new Request("https://admin.local/admin", { headers: await headers() }));
  if ("error" in auth) return <main className="main-entry-gate"><section className="admin-login-card"><span>ADMINISTRATOR ACCESS</span><div className="main-entry-logo" aria-hidden="true">智</div><h1>此 Google 帳號沒有管理權限</h1><p>Google 身分已由 Cloudflare Access 驗證；只有會員後台已開啟管理權限的相同 Email 才能進入。</p><a className="main-entry-medtech" href="/cdn-cgi/access/logout">切換 Google 帳號</a><a className="admin-login-back" href="/">回入口頁</a></section></main>;
  const { member } = auth;
  const email = member.email;

  if (member.status !== "active" || !member.canAdmin) {
    return (
      <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: "32px", background: "#f4f7fb" }}>
        <section style={{ width: "min(520px, 100%)", padding: "36px", border: "1px solid #d9e2ee", borderRadius: "20px", background: "white", boxShadow: "0 18px 45px rgba(35, 55, 80, .10)" }}>
          <div style={{ width: "48px", height: "48px", display: "grid", placeItems: "center", borderRadius: "14px", color: "#b42318", background: "#fff0ee", fontSize: "24px", marginBottom: "18px" }}>🔒</div>
          <p style={{ margin: "0 0 8px", color: "#637083", fontSize: "13px", letterSpacing: ".08em" }}>ADMIN ACCESS</p>
          <h1 style={{ margin: "0 0 12px", color: "#17243b", fontSize: "28px" }}>你沒有管理後台權限</h1>
          <p style={{ margin: "0 0 8px", color: "#536176", lineHeight: 1.7 }}>目前登入帳號：{email}</p>
          <p style={{ margin: "0 0 24px", color: "#536176", lineHeight: 1.7 }}>只有已啟用「管理權限」且帳號為使用中的會員可以進入。若需要權限，請由現有管理員在「學員管理」中設定。</p>
          <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
            <Link href="/law" style={{ padding: "11px 18px", borderRadius: "10px", color: "white", background: "#2d66b3", textDecoration: "none", fontWeight: 700 }}>回到學習平台</Link>
            <a href="/cdn-cgi/access/logout" style={{ padding: "11px 18px", border: "1px solid #cdd7e5", borderRadius: "10px", color: "#34445d", textDecoration: "none", fontWeight: 700 }}>切換 Google 帳號</a>
          </div>
        </section>
      </main>
    );
  }

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", padding: "9px 18px", color: "#dce9fb", background: "#172f52", fontSize: "13px" }}>
        <span>管理員已驗證｜{member.displayName || member.email}</span>
        <span style={{ display: "flex", gap: "14px" }}>
          <Link href="/law" style={{ color: "#fff", textDecoration: "none" }}>返回學生平台</Link>
          <form action="/api/admin-entry/logout" method="post" style={{ margin: 0 }}><button type="submit" style={{ padding: 0, border: 0, background: "none", color: "#fff", font: "inherit", cursor: "pointer" }}>登出</button></form>
        </span>
      </div>
      {children}
    </>
  );
}
