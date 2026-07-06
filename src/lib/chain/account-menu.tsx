"use client";

import Link from "next/link";
import { CheckIcon, CopyIcon } from "@/components/ui/icons";
import { NotificationDot } from "@/components/ui/notification-dot";
import { useCopied } from "@/components/ui/use-copied";
import { toast } from "@/components/ui/toast";
import { useData } from "@/lib/data/context";
import { useModerationAttention, useProfile, useSession } from "@/lib/data/hooks";
import { channelHue, shortAddress } from "@/lib/utils";

const itemCls =
  "flex w-full items-center rounded px-3 py-2 text-left text-small text-fg-muted transition-colors hover:bg-surface-raised hover:text-fg";

/**
 * Signed-in state in the header: the account monogram avatar. On hover (or focus — for touch/keyboard)
 * a menu drops down: Profile, Studio, copy address, sign out. Replaces the former wallet button. The balance next to it
 * is rendered separately by HeaderBalance.
 */
export function AccountMenu() {
  const data = useData();
  const session = useSession();
  const address = session.data?.address ?? null;
  const profile = useProfile(address);
  const { hasPending } = useModerationAttention();
  const [copied, markCopied] = useCopied(1200);

  if (!address) return null;
  const display = profile.data?.displayName?.trim();
  const name = display || address;
  const hue = channelHue(name);
  const initial = name.replace(/^@/, "")[0]?.toUpperCase() ?? "?";

  return (
    <div className="group relative">
      <button
        type="button"
        aria-label={hasPending ? "Account — something to review" : "Account"}
        className="relative flex h-9 w-9 items-center justify-center rounded-full font-display text-small outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-info"
        style={{ backgroundColor: `hsl(${hue} 45% 22%)`, color: `hsl(${hue} 70% 74%)` }}
      >
        {initial}
        {hasPending ? (
          <NotificationDot
            title="Something to review in the studio"
            className="absolute -right-0.5 -top-0.5 ring-2 ring-[var(--bg)]"
          />
        ) : null}
      </button>

      {/* Menu on hover/focus. pt-2 — an invisible "bridge" so the cursor doesn't lose hover on the way to the menu. */}
      <div className="invisible absolute right-0 top-full z-40 pt-2 opacity-0 transition-opacity duration-fast ease-ease group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100">
        <div className="w-52 rounded-lg border border-border bg-surface-raised p-1 shadow-lg">
          <div className="truncate px-3 pt-2 font-display text-fg">{display || "Account"}</div>
          <button
            type="button"
            title={copied ? "Copied" : "Copy address"}
            aria-label="Copy address"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(address);
                markCopied();
              } catch {
                toast({ variant: "error", title: "Couldn’t copy" });
              }
            }}
            className="flex w-full items-center gap-1.5 rounded px-3 py-1.5 text-left text-fg-faint transition-colors hover:bg-surface-raised hover:text-fg"
          >
            <span className="mono truncate text-small">{shortAddress(address)}</span>
            {copied ? (
              <CheckIcon className="h-3.5 w-3.5 shrink-0" />
            ) : (
              <CopyIcon className="h-3.5 w-3.5 shrink-0" />
            )}
          </button>
          <div className="my-1 border-t border-border" />
          <Link href="/me" className={itemCls}>
            Profile
          </Link>
          <Link href="/space" className={itemCls}>
            Personal Space
            {hasPending ? (
              <NotificationDot className="ml-2" title="Something to review in the queue" />
            ) : null}
          </Link>
          <button
            type="button"
            className={`${itemCls} hover:text-danger`}
            onClick={() => {
              void data.disconnect(); // full sign-out: revoke the token + disconnect the wallet (the bridge clears the session)
            }}
          >
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
}
