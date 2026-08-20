"use client";

import { useEffect, useState } from "react";

export function useSimulationToolsEnabled() {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    fetch("/api/site-settings", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) return;
        const result = (await response.json()) as { simulationToolsEnabled?: boolean };
        setEnabled(result.simulationToolsEnabled === true);
      })
      .catch(() => setEnabled(false));
  }, []);

  return enabled;
}
