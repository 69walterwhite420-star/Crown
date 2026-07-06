"use client";

import { useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ChevronRightIcon, InfoIcon } from "@/components/ui/icons";
import { IS_CHAIN } from "@/lib/chain/addresses";
import { pickerEntries, type PickerEntry, type RailContext } from "./picker";

/**
 * The viewer's right action rail (game-selection redesign). By default — the regular crown form (90% of cases).
 * At the top, a compact "other games" button → the list of games from the registry (icon + name + tagline + "i" rules).
 * Selecting a game → that game's form + a "back" arrow to the list. "i" → a modal with the game's rules.
 *
 * Money flows/forms are NOT touched — this is only the selection wrapper: we mount the existing forms from the registry.
 */
export function GameActionRail({
  channel,
  config,
  session,
  standing,
  standingLoading,
  handle,
  enabledGames,
}: RailContext & { enabledGames: string[] }) {
  // Memoize by enabledGames: stable entry identities → the game's form doesn't remount (doesn't lose input).
  const entries = useMemo(() => pickerEntries(enabledGames), [enabledGames]);
  const [currentId, setCurrentId] = useState("donate");
  const [picking, setPicking] = useState(false);
  const [rulesFor, setRulesFor] = useState<PickerEntry | null>(null);

  const current = entries.find((e) => e.id === currentId) ?? entries[0];
  if (!current) return null; // unreachable: "Crown" is always in the list — but we narrow the type for TS

  // H1: a realm without a signed payout accepts NO crowns — neither a regular crown nor a task — the server rejects it
  // (ingest for the crown, ESC-20 for the escrow task). We don't show a decoy form (the "no stubs" convention):
  // to the donor — an honest paused state, mirroring the owner panel's "crowns paused". Only on-chain modes (IS_CHAIN =
  // chain|icp); in mock/api attestation isn't required. Gates the WHOLE rail at once — the crown and all games in the picker.
  if (IS_CHAIN && !channel.payoutAttestation) {
    return (
      <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-4">
        <span className="text-small font-medium text-fg">Crowns paused</span>
        <span className="text-caption text-fg-muted">
          This realm hasn’t pinned its payout address by signature yet. Until the owner signs it, no
          crowns — donations or tasks — can be sent. This protects senders from a swapped address.
        </span>
      </div>
    );
  }
  const ctx: RailContext = { channel, config, session, standing, standingLoading, handle };

  return (
    <div className="flex flex-col gap-3">
      {picking ? (
        <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-3">
          <span className="text-caption uppercase tracking-wide text-fg-faint">What to do</span>
          {entries.map((e) => (
            <div
              key={e.id}
              className="flex items-center gap-1 rounded-lg border border-border bg-[var(--bg)] transition-colors hover:border-border-strong"
            >
              <button
                type="button"
                onClick={() => {
                  setCurrentId(e.id);
                  setPicking(false);
                }}
                aria-pressed={e.id === current.id}
                className="flex min-w-0 flex-1 items-center gap-3 p-3 text-left"
              >
                <e.Icon className="h-5 w-5 shrink-0 text-fg-muted" />
                <span className="min-w-0 truncate text-small text-fg">{e.name}</span>
              </button>
              <button
                type="button"
                onClick={() => setRulesFor(e)}
                className="mr-2 flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-fg-muted transition-colors hover:bg-surface-raised hover:text-fg"
                aria-label={`Rules: ${e.name}`}
                title="Rules"
              >
                <InfoIcon className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      ) : (
        // "other games" — in the top-right corner of the card, on the "My standing" row (per the mockup). Absolute,
        // so we don't touch the form/StandingHeadline; right/top-4 = matches the card's p-4; the tier badge is lower
        // (on the points row) — no conflict. A click → the game list.
        <div className="relative">
          <current.Form ctx={ctx} />
          {/* "other games" — only for a connected wallet: without sign-in the form shows "Connect your wallet",
              and the game-select button there is redundant (it overlapped the heading). */}
          {session.address ? (
            <button
              type="button"
              onClick={() => setPicking(true)}
              className="absolute right-4 top-4 z-10 flex items-center gap-0.5 text-[11px] leading-none text-fg-muted transition-colors hover:text-fg"
            >
              other games
              <ChevronRightIcon className="h-3 w-3" />
            </button>
          ) : null}
        </div>
      )}

      <Dialog open={!!rulesFor} onOpenChange={(o) => (o ? null : setRulesFor(null))}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{rulesFor?.name}</DialogTitle>
          </DialogHeader>
          {rulesFor ? <rulesFor.Rules channelId={channel.id} /> : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
