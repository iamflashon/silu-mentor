"use client";

import { useState } from "react";

export default function MemberLogoutButton() {
  const [busy, setBusy] = useState(false);

  async function logout() {
    if (busy) return;
    setBusy(true);
    try {
      await fetch("/api/member/logout", {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
      });
    } finally {
      window.location.replace(`/member-login?return_to=${encodeURIComponent("/medtech")}&logged_out=1&t=${Date.now()}`);
    }
  }

  return <button className="medtech-account-logout" type="button" onClick={logout} disabled={busy}>{busy ? "登出中…" : "登出並切換帳號"}</button>;
}
