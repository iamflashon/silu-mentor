"use client";

import { FormEvent, useState } from "react";

export default function LinePayPurchaseButton({
  packageName,
  packNumber,
  amount = 30,
  purchased = false,
  label,
}: {
  packageName: string;
  packNumber: number;
  amount?: number;
  purchased?: boolean;
  label?: string;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [loginOpen, setLoginOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loginBusy, setLoginBusy] = useState(false);
  const [loginError, setLoginError] = useState("");

  async function createPayment() {
    const response = await fetch("/api/medtech/line-pay/request", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ packageName, packNumber, amount }),
    });
    const data = (await response.json().catch(() => ({}))) as {
      paymentUrl?: string;
      error?: string;
    };
    if (response.status === 401) {
      setLoading(false);
      setLoginOpen(true);
      return;
    }
    if (!response.ok || !data.paymentUrl)
      throw new Error(data.error || "無法建立 LINE Pay 付款");
    window.location.assign(data.paymentUrl);
  }

  async function purchase() {
    if (loading || purchased) return;
    setLoading(true);
    setError("");
    try {
      const sessionResponse = await fetch("/api/member/session", {
        credentials: "same-origin",
        cache: "no-store",
      });
      const session = (await sessionResponse.json().catch(() => ({}))) as { authenticated?: boolean };
      if (!sessionResponse.ok || session.authenticated !== true) {
        setLoading(false);
        setLoginOpen(true);
        return;
      }
      await createPayment();
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "無法建立 LINE Pay 付款",
      );
      setLoading(false);
    }
  }

  async function loginAndPurchase(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loginBusy) return;
    setLoginBusy(true);
    setLoginError("");
    try {
      const response = await fetch("/api/member/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password, returnTo: "/medtech" }),
      });
      const result = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(result.error || "會員登入失敗");
      setLoginOpen(false);
      setLoading(true);
      await createPayment();
    } catch (reason) {
      setLoginError(reason instanceof Error ? reason.message : "會員登入失敗");
      setLoading(false);
    } finally {
      setLoginBusy(false);
    }
  }

  return (
    <div className="medtech-line-pay-purchase">
      <button
        type="button"
        onClick={() => void purchase()}
        disabled={loading || purchased}
      >
        {purchased
          ? "已付款・立即開始"
          : loading
            ? "正在前往 LINE Pay…"
            : label || `LINE Pay NT$${amount} 購買`}
      </button>
      {error && <small role="alert">{error}</small>}
      {loginOpen && (
        <div className="medtech-purchase-login-overlay" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setLoginOpen(false)}>
          <section className="medtech-purchase-login" role="dialog" aria-modal="true" aria-labelledby="medtech-purchase-login-title">
            <button className="medtech-purchase-login-close" type="button" aria-label="關閉登入視窗" onClick={() => setLoginOpen(false)}>×</button>
            <span>MEDTECH MEMBER ACCESS</span>
            <div className="medtech-purchase-login-logo" aria-hidden="true">醫</div>
            <h2 id="medtech-purchase-login-title">登入後接續 LINE Pay</h2>
            <p>請先登入醫檢師會員帳號，付款完成後方案會自動綁定此帳號。</p>
            <form onSubmit={loginAndPurchase}>
              <label htmlFor="medtech-purchase-email">會員帳號</label>
              <input id="medtech-purchase-email" type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} required autoFocus />
              <label htmlFor="medtech-purchase-password">會員密碼</label>
              <input id="medtech-purchase-password" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required />
              {loginError && <p className="admin-login-error" role="alert">{loginError}</p>}
              <button type="submit" disabled={loginBusy}>{loginBusy ? "登入中…" : "登入並前往 LINE Pay"}</button>
            </form>
            <div className="medtech-purchase-login-links">
              <a href="/medtech/member-login?return_to=%2Fmedtech">申請管理員重設密碼</a>
              <a href="/member-register?return_to=%2Fmedtech">註冊會員</a>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
