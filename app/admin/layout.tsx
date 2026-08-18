import Link from "next/link";
import { eq } from "drizzle-orm";
import { getDb } from "../../db";
import { members } from "../../db/schema";
import {
  chatGPTSignOutPath,
  requireChatGPTUser,
} from "../chatgpt-auth";

export const dynamic = "force-dynamic";

export default async function AdminLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const user = await requireChatGPTUser("/admin");
  const email = user.email.trim().toLowerCase();
  const db = await getDb();
  const [member] = await db
    .select()
    .from(members)
    .where(eq(members.email, email))
    .limit(1);

  if (!member || member.status !== "active" || !member.canAdmin) {
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
            <a href={chatGPTSignOutPath("/admin")} style={{ padding: "11px 18px", border: "1px solid #cdd7e5", borderRadius: "10px", color: "#34445d", textDecoration: "none", fontWeight: 700 }}>切換登入帳號</a>
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
          <a href={chatGPTSignOutPath("/law")} style={{ color: "#fff", textDecoration: "none" }}>登出</a>
        </span>
      </div>
      {children}
    </>
  );
}
