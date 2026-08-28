"use client";

import { useState } from "react";

export default function PengliCover({ className = "" }: { className?: string }) {
  const [failed, setFailed] = useState(false);
  return <div className={`pengli-managed-cover ${className}${failed ? " is-fallback" : ""}`}>
    {!failed && <img src="/api/portal-cards/cover?id=pengli" alt="行政法考點演習書書封" onError={() => setFailed(true)} />}
    {failed && <div className="pengli-cover-fallback" role="img" aria-label="行政法考點演習書預設書封">
      <small>彭狸老師專屬教材</small><strong>行政法考點</strong><span>演習書</span>
    </div>}
  </div>;
}
