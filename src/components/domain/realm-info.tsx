import { Amount } from "./amount";
import { TierBadge } from "./standing";
import { ExternalLinkIcon } from "@/components/ui/icons";
import { explorerAddressUrl } from "@/lib/chain/addresses";
import type { Channel, ChannelConfig } from "@/lib/data/types";
import { cn, formatPoints } from "@/lib/utils";

function fullDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" });
}

function InfoRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <span className="text-caption uppercase tracking-wide text-fg-faint">{label}</span>
      <span className="min-w-0 text-small text-fg">{children}</span>
    </div>
  );
}

/**
 * Rail card "Realm info": the realm's reference info in ONE place (pulled out of the Ranks/About tabs so the
 * center stays a clean feed). Two sections — the tier ladder (what ranks exist, compactly) and details (payout,
 * crown minimums, message policy, opening date). All static — fits a sticky rail, not tabs.
 */
export function RealmInfo({
  channel,
  config,
  currentTierName,
}: {
  channel: Channel;
  config?: ChannelConfig;
  currentTierName?: string;
}) {
  const tiers = config ? [...config.tiers].sort((a, b) => a.threshold - b.threshold) : [];
  return (
    <div className="flex flex-col gap-4 p-4">
      {/* Tier ladder — compactly: badge + threshold, current one highlighted. Perks/descriptions live in the "Ranks" spec. */}
      <section className="flex flex-col gap-2">
        <h3 className="text-caption uppercase tracking-wide text-fg-faint">Tiers</h3>
        {config ? (
          <ul className="flex flex-col gap-0.5">
            {tiers.map((t) => (
              <li
                key={t.name}
                className={cn(
                  "flex items-center justify-between gap-2 rounded-md px-2 py-1.5",
                  t.name === currentTierName && "bg-surface-raised",
                )}
              >
                <TierBadge tier={t} />
                <span className="mono text-small text-fg-muted">{formatPoints(t.threshold)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-small text-fg-faint">No tiers configured.</p>
        )}
      </section>

      {/* Realm details — what isn't in the hero. */}
      <section className="flex flex-col border-t border-border pt-2">
        <h3 className="pb-1 text-caption uppercase tracking-wide text-fg-faint">Details</h3>
        <InfoRow label="Payout">
          <a
            href={explorerAddressUrl(channel.payoutAddress)}
            target="_blank"
            rel="noopener noreferrer"
            className="mono inline-flex items-center gap-1 break-all text-fg-muted transition-colors hover:text-fg"
          >
            {channel.payoutAddress}
            <ExternalLinkIcon className="h-3.5 w-3.5 shrink-0" />
          </a>
        </InfoRow>
        {config ? (
          <>
            <InfoRow label="Min crown">
              <Amount micro={config.minDonation} className="text-fg" />
            </InfoRow>
            <InfoRow label="+ message">
              {channel.status === "ACTIVE" ? (
                <Amount micro={config.minDonationWithText} className="text-fg" />
              ) : (
                <span className="text-fg-faint">Not activated</span>
              )}
            </InfoRow>
            <InfoRow label="Messages">
              <span className="text-fg-muted">
                {config.textShowMode === "auto_if_clean" ? "Auto-shown if clean" : "Private until shown"}
              </span>
            </InfoRow>
          </>
        ) : null}
        <InfoRow label="Opened">
          <span className="text-fg-muted">{fullDate(channel.createdAt)}</span>
        </InfoRow>
      </section>
    </div>
  );
}
