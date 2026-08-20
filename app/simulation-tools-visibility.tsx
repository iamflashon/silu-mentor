"use client";

import { useEffect } from "react";

export default function SimulationToolsVisibility() {
  useEffect(() => {
    let active = true;
    const apply = (enabled: boolean) => {
      document.documentElement.classList.toggle("simulation-tools-enabled", enabled);
      document.documentElement.classList.toggle("simulation-tools-disabled", !enabled);
    };
    apply(false);
    fetch("/api/site-settings", { cache: "no-store" })
      .then(async (response) => response.ok ? (await response.json()) as { simulationToolsEnabled?: boolean } : null)
      .then((result) => { if (active) apply(result?.simulationToolsEnabled === true); })
      .catch(() => { if (active) apply(false); });
    const onChange = (event: Event) => apply((event as CustomEvent<boolean>).detail === true);
    window.addEventListener("simulation-tools-change", onChange);
    return () => { active = false; window.removeEventListener("simulation-tools-change", onChange); };
  }, []);
  return null;
}
