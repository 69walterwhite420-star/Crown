"use client";

import { useEffect, useState } from "react";

/** Состояние «свёрнут ли сайдбар», с сохранением в localStorage по ключу. Desktop-only фича. */
export function useRailCollapsed(key: string) {
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    try {
      if (localStorage.getItem(key) === "1") setCollapsed(true);
    } catch {
      // localStorage может быть недоступен — не критично
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
 * Круглая кнопка на правой границе сайдбара (как в FusionPay): золотое кольцо + шеврон.
 * Свёрнут → шеврон вправо (развернуть), развёрнут → влево (свернуть). `width` — ширина развёрнутого сайдбара
 * (rem), чтобы кнопка села ровно на границу. Только на десктопе (md+); position: fixed под верхней полосой.
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
