"use client";

import { useState } from "react";

export default function MemberLogoutButton() {
  const [busy, setBusy] = useState(false);

  async function logout() {
    if (busy) return;
    setBusy(true);
    // Use the server redirect so the dispatch-owned ChatGPT sign-out route is
    // actually visited.  A background fetch followed by /medtech only reloads
    // the existing authenticated session and does not sign the member out.
    window.location.assign(
      "/api/member/logout?return_to=%2Fmedtech%3Flogged_out%3D1",
    );
  }

  return <button className="medtech-account-logout" type="button" onClick={logout} disabled={busy}>{busy ? "正在登出本站…" : "登出本站"}</button>;
}
