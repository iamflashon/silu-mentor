"use client";
import { useState } from "react";

export default function AccountingPurchaseButton({ active }: { active: boolean }) {
  const [busy, setBusy] = useState(false); const [notice, setNotice] = useState("");
  async function purchase() { setBusy(true); setNotice(""); const response = await fetch("/api/accounting/line-pay/request", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({}) }); const data = await response.json(); if (response.ok && data.paymentUrl) { window.location.href = data.paymentUrl; return; } setBusy(false); setNotice(data.error || "目前無法建立付款"); }
  if (!active) return <button type="button" disabled>目前暫停販售</button>;
  return <><button type="button" disabled={busy} onClick={() => void purchase()}>{busy ? "正在前往 LINE Pay…" : "LINE Pay 購買"}</button>{notice && <small className="accounting-payment-notice">{notice}</small>}</>;
}
