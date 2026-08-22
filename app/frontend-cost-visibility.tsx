"use client";

import { useEffect } from "react";

export default function FrontendCostVisibility() {
  useEffect(() => {
    let active = true;
    const apply = (enabled: boolean) => {
      document.documentElement.classList.toggle("frontend-costs-enabled", enabled);
      document.documentElement.classList.toggle("frontend-costs-disabled", !enabled);
    };
    apply(false);
    fetch("/api/usage", { cache: "no-store" })
      .then(async (response) => response.ok ? (await response.json()) as { showCosts?: boolean } : null)
      .then((result) => { if (active) apply(result?.showCosts === true); })
      .catch(() => { if (active) apply(false); });
    const onChange = (event: Event) => apply((event as CustomEvent<boolean>).detail === true);
    window.addEventListener("frontend-costs-change", onChange);
    return () => { active = false; window.removeEventListener("frontend-costs-change", onChange); };
  }, []);
  return null;
}
