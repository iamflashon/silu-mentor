"use client";

import { useEffect, useRef, useState } from "react";

const MAX_WAIT_MS = 5000;
const QUICK_FEEDBACK_MS = 420;

export default function NavigationFeedback() {
  const [navigating, setNavigating] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const clear = () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
      setNavigating(false);
      document.querySelectorAll(".is-action-pending").forEach((node) => node.classList.remove("is-action-pending"));
    };

    const handleClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const target = event.target instanceof Element ? event.target : null;
      const action = target?.closest<HTMLElement>("button, a[href]");
      const isMedtechNavigation = Boolean(action?.closest(".medtech-home, .medtech-practice, .medtech-ai-page, .medtech-notes-page, .medtech-pricing-page, .medtech-upgrade-page"));
      if (!action || action.matches(":disabled, [aria-disabled='true']") || (action.closest("[data-no-navigation-feedback]") && !isMedtechNavigation)) return;

      action.classList.add("is-action-pending");
      window.setTimeout(() => action.classList.remove("is-action-pending"), QUICK_FEEDBACK_MS);

      if (!(action instanceof HTMLAnchorElement)) return;
      const url = new URL(action.href, window.location.href);
      if (url.origin !== window.location.origin || url.href === window.location.href || action.target === "_blank" || action.hasAttribute("download")) return;

      // Wait until the click event finishes bubbling, then show feedback
      // immediately so the transition never feels like a dead tap.
      queueMicrotask(() => {
        setNavigating(true);
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
        timeoutRef.current = setTimeout(clear, MAX_WAIT_MS);
      });
    };

    document.addEventListener("click", handleClick, true);
    window.addEventListener("pageshow", clear);
    window.addEventListener("popstate", clear);
    return () => {
      document.removeEventListener("click", handleClick, true);
      window.removeEventListener("pageshow", clear);
      window.removeEventListener("popstate", clear);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  return navigating ? (
    <div className="navigation-feedback" role="status" aria-live="polite" aria-label="正在切換頁面">
      <i aria-hidden="true" />
      <span><b aria-hidden="true" />正在開啟…</span>
    </div>
  ) : null;
}
