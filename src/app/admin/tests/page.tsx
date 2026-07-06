"use client";

import { useQueryClient } from "@tanstack/react-query";
import { DevToolbar } from "@/components/layout/dev-toolbar";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { useData } from "@/lib/data/context";
import { demoAddress } from "@/lib/data/dev-identity";
import { useDevControls, useDiscovery } from "@/lib/data/hooks";

// Быстрый вход за засеянные демо-личности (адрес детерминирован из метки через demoAddress).
const QUICK = [
  { label: "Max · donor", who: "max" },
  { label: "WhaleMoon · whale", who: "whalemoon" },
  { label: "PixelQueen · realm owner", who: "owner-pixel" },
  { label: "RaidBoss · realm owner", who: "owner-raid" },
  { label: "Fresh wallet · no history", who: "fresh-tester" },
];

/**
 * Admin → Tests. Dev-инструменты (только mock/api — в chain вход через SIWS-подпись):
 * вход без кошелька (быстрые личности / любой адрес), плюс управление тестовыми данными (сид/вайп).
 */
export default function AdminTestsPage() {
  const dev = useDevControls();
  const provider = useData();
  const qc = useQueryClient();
  const discovery = useDiscovery();
  const realmCount = discovery.data?.items.length ?? 0;

  // seedDemo есть только у mock-провайдера (браузерный стор). В api/chain его нет.
  const seedFn = (provider as { seedDemo?: () => void }).seedDemo;
  const canSeed = typeof seedFn === "function";

  function seedDemo() {
    // seedDemo() — no-op, если стор не пуст (гард в провайдере). Поэтому сначала чистим, затем сеем →
    // кнопка всегда даёт ровно 6 демо-realms, даже если они уже были.
    dev.reset();
    seedFn?.();
    qc.invalidateQueries();
    toast({
      variant: "success",
      title: "Seeded 6 demo realms",
      description: "pixelqueen, lofimira, raidboss, marinacooks, devbyte, latenight — with patrons.",
    });
  }

  function wipeAll() {
    dev.reset(); // чистит realms, доноров, профили, журнал — и инвалидирует кэш
    toast({ variant: "success", title: "Wiped", description: "All test realms and users removed." });
  }

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-1">
        <h1 className="text-h2 text-fg">Tests</h1>
        <p className="text-small text-fg-faint">
          Sign in without a wallet and manage test data. Dev only — works in mock/api mode.
        </p>
      </div>

      {!dev.available ? (
        <div className="rounded-lg border border-border bg-surface p-4 text-small text-fg-muted">
          Dev tools are available only in <span className="mono">mock</span> / <span className="mono">api</span> mode
          (current mode has no wallet-less login). Switch <span className="mono">NEXT_PUBLIC_DATA_SOURCE</span>.
        </div>
      ) : (
        <>
          {/* Тестовые данные */}
          <section className="flex flex-col gap-2">
            <span className="text-caption uppercase tracking-wide text-fg-faint">
              Test data · {realmCount} realm{realmCount === 1 ? "" : "s"} now
            </span>
            <div className="flex flex-wrap gap-2">
              {canSeed ? (
                <Button size="sm" onClick={seedDemo}>
                  Seed 6 demo realms
                </Button>
              ) : null}
              <Button size="sm" variant="danger" onClick={wipeAll}>
                Wipe all realms &amp; users
              </Button>
            </div>
            <p className="text-caption text-fg-faint">
              «Seed» adds the 6 demo realms (pixelqueen, lofimira, raidboss, marinacooks, devbyte, latenight) with
              their patrons; «Wipe» removes every test realm and user. Reload re-seeds from env.
            </p>
          </section>

          {/* Вход без кошелька */}
          <section className="flex flex-col gap-2">
            <span className="text-caption uppercase tracking-wide text-fg-faint">Quick sign-in</span>
            <div className="flex flex-wrap gap-2">
              {QUICK.map((q) => (
                <Button
                  key={q.who}
                  size="sm"
                  variant="secondary"
                  onClick={() => dev.setAddress(demoAddress(q.who))}
                >
                  {q.label}
                </Button>
              ))}
            </div>
          </section>

          <DevToolbar />
        </>
      )}
    </div>
  );
}
