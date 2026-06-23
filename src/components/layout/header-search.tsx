"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/** Поиск каналов в шапке (как search Polymarket): Enter → Discovery с этим запросом (?q=). */
export function HeaderSearch() {
  const router = useRouter();
  const [q, setQ] = useState("");
  return (
    <form
      className="hidden md:block"
      onSubmit={(e) => {
        e.preventDefault();
        router.push(q.trim() ? `/?q=${encodeURIComponent(q.trim())}` : "/");
      }}
    >
      <input
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Поиск каналов…"
        aria-label="Поиск каналов"
        className="h-9 w-56 rounded border border-border bg-surface px-3 text-small text-fg placeholder:text-fg-faint focus-visible:outline focus-visible:outline-2 focus-visible:outline-info"
      />
    </form>
  );
}
