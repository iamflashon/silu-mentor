"use client";

import { useEffect, useState } from "react";
import type { PortalModule } from "../../../lib/portal-modules";
import "./pengli.css";

export default function PengliModules() {
  const [modules, setModules] = useState<PortalModule[]>([]);
  useEffect(() => { void fetch("/api/portal-modules?scope=pengli", { cache: "no-store" }).then((response) => response.json()).then((data) => setModules(data.modules ?? [])).catch(() => undefined); }, []);
  const visible = modules.filter((module) => module.enabled).sort((a, b) => a.order - b.order);
  if (!visible.length) return null;
  return <section className="pengli-module-shelf pengli-module-shelf-compact" aria-label="彭狸專區功能模組"><div className="pengli-module-grid">{visible.map((module) => <a className="pengli-module-card" href={module.href} key={module.id}><b>{module.icon}</b><div><strong>{module.label}</strong><span>{module.description}</span></div><i>→</i></a>)}</div></section>;
}
