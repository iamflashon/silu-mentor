"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";

function returnToFromLocation() {
  if (typeof window === "undefined") return "/";
  const value = new URLSearchParams(window.location.search).get("return_to") ?? "/";
  return value.startsWith("/") && !value.startsWith("//") && !value.includes("\\") ? value : "/";
}

export default function MemberLoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [loggedOut, setLoggedOut] = useState(false);
<<<<<<< HEAD
=======
  const [forgotOpen, setForgotOpen] = useState(false);
  const [forgotBusy, setForgotBusy] = useState(false);
  const [forgotMessage, setForgotMessage] = useState("");
  const [medtechEntry, setMedtechEntry] = useState(false);
>>>>>>> 6d3de7d9 (Use medtech login route before LINE Pay purchase)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setLoggedOut(params.get("logged_out") === "1");
    const returnTo = params.get("return_to") ?? "";
    setMedtechEntry(returnTo === "/medtech" || returnTo.startsWith("/medtech/"));
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    const returnTo = returnToFromLocation();
    try {
      const response = await fetch("/api/member/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password, returnTo }),
      });
      const result = await response.json().catch(() => ({})) as { returnTo?: string; error?: string };
      if (!response.ok) throw new Error(result.error ?? "會員登入失敗。");
      window.location.assign(result.returnTo?.startsWith("/") ? result.returnTo : returnTo);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "會員登入失敗。");
      setBusy(false);
    }
  }

  return <main className="main-entry-gate">
    <section className="admin-login-card">
      <span>{medtechEntry ? "MEDTECH MEMBER ACCESS" : "MEMBER ACCESS"}</span>
      <div className="main-entry-logo" aria-hidden="true">{medtechEntry ? "醫" : "智"}</div>
      <h1>{medtechEntry ? "醫檢師會員登入" : "會員登入"}</h1>
      <p>{medtechEntry ? "登入後即可保存免費體驗、購買通行證與學習紀錄。" : "請使用管理員建立的會員帳號與密碼，登入後即可使用司律或醫檢師學習功能。"}</p>
      {loggedOut ? <p className="member-login-switched" role="status">已完成登出，現在可以輸入另一個會員帳號。</p> : null}
      <form className="admin-login-form" onSubmit={submit}>
        <label htmlFor="member-login-email">會員帳號</label>
        <input id="member-login-email" type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} required autoFocus />
        <label htmlFor="member-login-password">會員密碼</label>
        <input id="member-login-password" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required />
        {error ? <p className="admin-login-error" role="alert">{error}</p> : null}
        <button type="submit" disabled={busy}>{busy ? "驗證中…" : medtechEntry ? "登入醫檢師備考" : "登入會員平台"}</button>
      </form>
      <p className="member-login-help">尚未有會員帳號？註冊後即可免費體驗 30 題。</p>
      <Link className="main-entry-medtech member-register-link" href={`/member-register?return_to=${encodeURIComponent(returnToFromLocation())}`}>立即註冊</Link>
      <Link className="admin-login-back" href={medtechEntry ? "/medtech" : "/"}>{medtechEntry ? "回醫檢師首頁" : "回入口頁"}</Link>
    </section>
  </main>;
}
