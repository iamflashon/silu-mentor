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
  const [forgotOpen, setForgotOpen] = useState(false);
  const [forgotBusy, setForgotBusy] = useState(false);
  const [forgotMessage, setForgotMessage] = useState("");
  const [medtechEntry, setMedtechEntry] = useState(false);

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

  async function requestPasswordReset(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (forgotBusy) return;
    setForgotBusy(true);
    setForgotMessage("");
    try {
      const response = await fetch("/api/member/password-reset/request", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const result = await response.json() as { message?: string };
      setForgotMessage(result.message ?? "申請已送出。");
    } catch {
      setForgotMessage("目前無法送出申請，請稍後再試。");
    } finally {
      setForgotBusy(false);
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
      <button type="button" className="member-forgot-password-toggle" onClick={() => { setForgotOpen((value) => !value); setForgotMessage(""); }}>忘記密碼？</button>
      {forgotOpen && <form className="member-forgot-password" onSubmit={requestPasswordReset}>
        <h2>申請管理員協助重設</h2>
        <p>輸入註冊 Email，申請會顯示在總管理處。目前採人工處理，不會寄送重設信；管理員確認身分後會設定臨時密碼並另行通知。</p>
        <label htmlFor="member-reset-email">註冊 Email</label>
        <input id="member-reset-email" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
        <button type="submit" disabled={forgotBusy}>{forgotBusy ? "送出中…" : "送出人工重設申請"}</button>
        {forgotMessage && <p role="status" className="member-reset-message">{forgotMessage}</p>}
      </form>}
      <p className="member-login-help">尚未有會員帳號？註冊後即可免費體驗 30 題。</p>
      <Link className="main-entry-medtech member-register-link" href={`/member-register?return_to=${encodeURIComponent(returnToFromLocation())}`}>立即註冊</Link>
      <Link className="admin-login-back" href={medtechEntry ? "/medtech" : "/"}>{medtechEntry ? "回醫檢師首頁" : "回入口頁"}</Link>
    </section>
  </main>;
}
