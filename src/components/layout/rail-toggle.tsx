"use client";

import { useEffect, useState } from "react";

/** State of "is the sidebar collapsed", persisted in localStorage under a key. Desktop-only feature. */
export function useRailCollapsed(key: string) {
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    try {
      if (localStorage.getItem(key) === "1") setCollapsed(true);
    } catch {
      // localStorage may be unavailable — not critical
    }
  }, [key]);
  const toggle = () =>
    setCollapsed((c) => {
      const next = !c;
      try {
        localStorage.setItem(key, next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  return { collapsed, toggle };
}

/**
 * Round button on the right edge of the sidebar (as in FusionPay): a gold ring + chevron.
 * Collapsed → chevron points right (expand), expanded → left (collapse). `width` is the width of the expanded
 * sidebar (rem), so the button sits exactly on the edge. Desktop only (md+); position: fixed under the top bar.
 */
export function RailToggle({
  collapsed,
  onToggle,
  width,
}: {
  collapsed: boolean;
  onToggle: () => void;
  width: string;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
      title={collapsed ? "Expand" : "Collapse"}
      className="fixed top-[44px] z-40 hidden h-6 w-6 -translate-x-1/2 items-center justify-center rounded-full border border-money-dim bg-surface text-money shadow-sm shadow-black/30 transition-[left,border-color,background-color] duration-slow ease-ease hover:border-money hover:bg-money-bg md:flex"
      style={{ left: collapsed ? "3.5rem" : width }}
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-3 w-3"
        aria-hidden="true"
      >
        {collapsed ? <path d="m9 6 6 6-6 6" /> : <path d="m15 6-6 6 6 6" />}
      </svg>
    </button>
  );
}
