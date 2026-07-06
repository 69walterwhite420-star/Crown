"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { SearchIcon } from "@/components/ui/icons";

/**
 * Realm search in the header (like Polymarket's search): Enter → Discovery with this query (?q=).
 * Desktop (md+): the field is always visible. Mobile (<md): to avoid eating up the narrow header, we show a magnifier icon;
 * on tap it expands into a field over the whole header (focus immediately, close via Esc / "Cancel").
 */
export function HeaderSearch() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false); // mobile mode: expanded field over the header
  const inputRef = useRef<HTMLInputElement>(null);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    router.push(q.trim() ? `/?q=${encodeURIComponent(q.trim())}` : "/");
    setOpen(false);
  }

  // On expand on mobile — focus the field and close on Escape.
  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const inputCls =
    "h-9 w-full rounded border border-border bg-[var(--bg)] pl-9 pr-3 text-small text-fg placeholder:text-fg-faint focus-visible:outline focus-visible:outline-2 focus-visible:outline-info";

  return (
    <>
      {/* Desktop: the field is always visible. */}
      <form className="relative hidden md:block" onSubmit={submit}>
        <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-faint" />
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search realms…"
          aria-label="Search realms"
          className={`${inputCls} w-56`}
        />
      </form>

      {/* Mobile: magnifier icon; on tap — an expanded field over the header. */}
      <button
        type="button"
        aria-label="Search realms"
        onClick={() => setOpen(true)}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border text-fg-muted transition-colors hover:border-border-strong hover:text-fg md:hidden"
      >
        <SearchIcon className="h-[18px] w-[18px]" />
      </button>
      {open ? (
        <form
          className="absolute inset-0 z-40 flex items-center gap-2 bg-[var(--bg)] px-4 md:hidden"
          onSubmit={submit}
        >
          <div className="relative flex-1">
            <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-faint" />
            <input
              ref={inputRef}
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search realms…"
              aria-label="Search realms"
              className={inputCls}
            />
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="text-small shrink-0 px-1 text-fg-muted transition-colors hover:text-fg"
          >
            Cancel
          </button>
        </form>
      ) : null}
    </>
  );
}
