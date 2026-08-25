"use client";

import { useState } from "react";

export default function MemberLogoutButton() {
  const [busy, setBusy] = useState(false);

  async function logout() {
    if (busy) return;
    setBusy(true);
    // Clear the platform cookie first. The route then redirects to
    // Cloudflare Access logout so the next visit can choose another Google
    // account instead of silently restoring the previous Access identity.
    const isCloudflareAccess = window.location.hostname === "silu-mentor.iamflashon.workers.dev";
    window.location.assign(
      isCloudflareAccess
        ? "/api/member/logout?return_to=%2Fmedtech"
        : "/signout-with-chatgpt?return_to=%2Fmedtech",
    );
  }

  return <button className="medtech-account-logout" type="button" onClick={logout} disabled={busy}>{busy ? "正在登出並切換…" : "登出並切換帳號"}</button>;
}
