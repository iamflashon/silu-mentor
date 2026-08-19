"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import "../entry-gate.css";

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
      <span>MEMBER ACCESS</span>
      <div className="main-entry-logo" aria-hidden="true">智</div>
      <h1>會員登入</h1>
      <p>請使用管理員建立的會員帳號與密碼，登入後即可使用司律或醫檢師學習功能。</p>
      <form className="admin-login-form" onSubmit={submit}>
        <label htmlFor="member-login-email">會員帳號</label>
        <input id="member-login-email" type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} required autoFocus />
        <label htmlFor="member-login-password">會員密碼</label>
        <input id="member-login-password" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required />
        {error ? <p className="admin-login-error" role="alert">{error}</p> : null}
        <button type="submit" disabled={busy}>{busy ? "驗證中…" : "登入會員平台"}</button>
      </form>
      <p className="member-login-help">尚未有會員帳號？請聯絡管理員建立帳號並提供初始密碼。</p>
      <Link className="admin-login-back" href="/">回入口頁</Link>
    </section>
  </main>;
}
