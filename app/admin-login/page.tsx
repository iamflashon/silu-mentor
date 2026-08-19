"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import "../entry-gate.css";

function returnToFromLocation() {
  if (typeof window === "undefined") return "/";
  const value = new URLSearchParams(window.location.search).get("return_to") ?? "/";
  return value.startsWith("/") && !value.startsWith("//") && !value.includes("\\") ? value : "/";
}

export default function AdminLoginPage() {
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
      const response = await fetch("/api/admin-entry/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password, returnTo }),
      });
      const result = await response.json().catch(() => ({})) as { returnTo?: string; error?: string };
      if (!response.ok) throw new Error(result.error ?? "管理員登入失敗。");
      window.location.assign(result.returnTo?.startsWith("/") ? result.returnTo : returnTo);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "管理員登入失敗。");
      setBusy(false);
    }
  }

  return <main className="main-entry-gate">
    <section className="admin-login-card">
      <span>ADMINISTRATOR ACCESS</span>
      <div className="main-entry-logo" aria-hidden="true">智</div>
      <h1>管理員登入</h1>
      <p>請輸入管理員帳號與密碼，驗證後才能進入司律備考與醫檢師平台。</p>
      <form className="admin-login-form" onSubmit={submit}>
        <label htmlFor="admin-entry-email">管理員帳號</label>
        <input id="admin-entry-email" type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} required autoFocus />
        <label htmlFor="admin-entry-password">管理員密碼</label>
        <input id="admin-entry-password" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required />
        {error ? <p className="admin-login-error" role="alert">{error}</p> : null}
        <button type="submit" disabled={busy}>{busy ? "驗證中…" : "登入並進入平台"}</button>
      </form>
      <Link className="admin-login-back" href="/">回入口頁</Link>
    </section>
  </main>;
}
