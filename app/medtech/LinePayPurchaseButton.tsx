"use client";

import { useState } from "react";

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
        window.location.assign(`/member-login?return_to=${encodeURIComponent("/medtech")}`);
        return;
      }
      const response = await fetch("/api/medtech/line-pay/request", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ packageName, packNumber, amount }),
      });
      const data = (await response.json()) as {
        paymentUrl?: string;
        error?: string;
      };
      if (!response.ok || !data.paymentUrl)
        throw new Error(data.error || "無法建立 LINE Pay 付款");
      window.location.assign(data.paymentUrl);
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
    </div>
  );
}
