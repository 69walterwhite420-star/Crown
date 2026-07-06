"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { RankBadge } from "@/components/domain/rank-badge";
import { useDevControls, useDonorOverview, useSession } from "@/lib/data/hooks";
import { demoAddress } from "@/lib/data/dev-identity";
import { fromMicro, shortAddress } from "@/lib/utils";

/**
 * Контрол кошелька в шапке CROWN.
 * Фаза 1 (mock): «Connect wallet» садит сессию на демо-донора `max` (есть Reign во всех дворах) через
 * dev-controls движка — реальную wallet-логику не дублируем. Фаза 3: сюда сядет ChainConnect (SIWS).
 */
export function CrownWallet() {
  const { data: session, isLoading } = useSession();
  const dev = useDevControls();

  if (isLoading) {
    return <div className="h-9 w-32 animate-pulse rounded bg-surface-2" aria-hidden />;
  }

  if (!session?.address) {
    return (
      <button
        type="button"
        onClick={() => dev.available && dev.setAddress(demoAddress("max"))}
        className="rounded border border-money-dim bg-money-bg/40 px-3.5 py-2 font-body text-small font-semibold text-money transition-colors hover:border-money hover:bg-money-bg"
      >
        Connect wallet
      </button>
    );
  }

  return <IdentityMenu address={session.address} onDisconnect={() => dev.setAddress(null)} />;
}

function IdentityMenu({ address, onDisconnect }: { address: string; onDisconnect: () => void }) {
  const [open, setOpen] = useState(false);
  const overview = useDonorOverview(address);
  const points = overview.data?.topStanding?.points ?? 0;

  // Esc закрывает меню.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex items-center gap-2 rounded-pill border border-border bg-surface py-1.5 pl-1.5 pr-3 transition-colors hover:border-border-strong"
      >
        <RankBadge points={points} size={28} />
        <span className="mono text-small text-fg-muted">{shortAddress(address)}</span>
      </button>

      {open && (
        <>
          <button
            type="button"
            aria-label="Close menu"
            className="fixed inset-0 z-40 cursor-default"
            onClick={() => setOpen(false)}
          />
          <div
            role="menu"
            className="absolute right-0 z-50 mt-2 w-56 overflow-hidden rounded-lg border border-border bg-surface shadow-xl shadow-black/40"
          >
            <div className="flex items-center gap-3 border-b border-border px-3 py-3">
              <RankBadge points={points} size={34} />
              <div className="flex min-w-0 flex-col">
                <span className="mono text-small text-fg">{shortAddress(address)}</span>
                <span className="text-caption text-fg-faint">
                  {overview.data ? `$${Math.round(fromMicro(overview.data.totalDonated)).toLocaleString("en-US")} crowned` : "…"}
                </span>
              </div>
            </div>
            <MenuLink href="/space" onClick={() => setOpen(false)}>
              Personal Space
            </MenuLink>
            <MenuLink href="/me" onClick={() => setOpen(false)}>
              My reign
            </MenuLink>
            <MenuLink href="/me/profile" onClick={() => setOpen(false)}>
              Profile settings
            </MenuLink>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onDisconnect();
              }}
              className="w-full border-t border-border px-3 py-2.5 text-left text-small text-fg-muted transition-colors hover:bg-surface-2 hover:text-danger"
            >
              Disconnect
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function MenuLink({ href, onClick, children }: { href: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      role="menuitem"
      onClick={onClick}
      className="block px-3 py-2.5 text-small text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg"
    >
      {children}
    </Link>
  );
}
