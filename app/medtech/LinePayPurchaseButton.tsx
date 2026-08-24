"use client";

import { useState } from "react";

export default function LinePayPurchaseButton({
  packageName,
  packNumber,
  amount = 30,
  purchased = false,
  label,
  memberEmail,
  purchaseExpiresAt,
  purchaseProof,
}: {
  packageName: string;
  packNumber: number;
  amount?: number;
  purchased?: boolean;
  label?: string;
  memberEmail: string;
  purchaseExpiresAt: number;
  purchaseProof: string;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [authRequired, setAuthRequired] = useState(false);

  async function createPayment() {
    const response = await fetch("/api/medtech/line-pay/request", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ packageName, packNumber, amount, memberEmail, purchaseExpiresAt, purchaseProof }),
    });
    const data = (await response.json().catch(() => ({}))) as {
      paymentUrl?: string;
      error?: string;
    };
    if (response.status === 401) {
      setLoading(false);
      setAuthRequired(true);
      throw new Error("付款授權已過期，請重新整理頁面後再試一次");
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
      await createPayment();
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "無法建立 LINE Pay 付款",
      );
      setLoading(false);
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
      {authRequired && (
        <div className="medtech-purchase-login-overlay" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setAuthRequired(false)}>
          <section className="medtech-purchase-login medtech-google-relogin" role="dialog" aria-modal="true" aria-labelledby="medtech-google-relogin-title">
            <button className="medtech-purchase-login-close" type="button" aria-label="關閉視窗" onClick={() => setAuthRequired(false)}>×</button>
            <span>PAYMENT AUTHORIZATION</span>
            <div className="medtech-purchase-login-logo" aria-hidden="true">醫</div>
            <h2 id="medtech-google-relogin-title">付款授權已過期</h2>
            <p>你的 Google 會員身分仍保持登入；只需重新整理此頁取得新的短效付款授權，不必登出或切換帳號。</p>
            <button className="medtech-google-relogin-button" type="button" onClick={() => window.location.reload()}>重新整理並繼續付款</button>
            <button className="medtech-google-relogin-cancel" type="button" onClick={() => setAuthRequired(false)}>暫時不要付款</button>
          </section>
        </div>
      )}
    </div>
  );
}
