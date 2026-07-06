import Link from "next/link";
import { Amount } from "./amount";
import { PlatformIcon } from "./channel-links";
import { explorerAddressUrl } from "@/lib/chain/addresses";
import { platformDef } from "@/lib/channel-links";
import type { ChannelCard } from "@/lib/data/types";
import { channelHue, plural, shortAddress } from "@/lib/utils";

const DONORS = ["supporter", "supporters", "supporters"] as const;

/** Realm card in Discovery: monogram, name/@handle, tier, description, supporter info, mini links
 *  to socials and the payout address. The body is a link to the realm; socials/wallet are separate links (not nested). */
export function ChannelCardTile({ card }: { card: ChannelCard }) {
  const named = Boolean(card.displayName?.trim());
  const name = card.displayName?.trim() || `@${card.handle}`;
  const hue = channelHue(name);
  const links = card.links ?? [];
  const MAX_LINKS = 4; // beyond that — an ellipsis to the realm page (all links are there)
  const shownLinks = links.slice(0, MAX_LINKS);
  const hiddenLinks = links.length - shownLinks.length;

  return (
    <div className="group flex flex-col gap-3 rounded-lg border border-border bg-surface px-4 pt-4 pb-0 transition-colors duration-fast ease-ease hover:border-border-strong">
      {/* Clickable body → realm page */}
      <Link href={`/c/${card.handle}`} className="flex flex-col gap-3">
        <div className="flex items-start gap-3">
          {card.avatarUrl ? (
            // External avatar URL — a plain <img> (next/image requires a host allowlist).
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={card.avatarUrl}
              alt=""
              className="h-11 w-11 shrink-0 rounded-full object-cover"
            />
          ) : (
            <div
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full font-display text-h3"
              style={{ backgroundColor: `hsl(${hue} 45% 20%)`, color: `hsl(${hue} 70% 72%)` }}
            >
              {name.replace(/^@/, "")[0]?.toUpperCase() ?? "?"}
            </div>
          )}
          <div className="min-w-0 flex-1">
            <span className="block truncate font-display text-fg transition-colors group-hover:text-status">
              {name}
            </span>
            {named ? (
              <div className="mono truncate text-small text-fg-faint">@{card.handle}</div>
            ) : null}
          </div>
          <span className="shrink-0 rounded-pill border border-border px-2 py-0.5 text-small text-fg-muted">
            {card.topTierName}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-small text-fg-muted">
          <span>
            <span className="font-medium">{card.donorsCount}</span>{" "}
            {plural(card.donorsCount, DONORS)}
          </span>
          <span className="flex items-center gap-1">
            volume <Amount micro={card.totalDonated} />
          </span>
        </div>
      </Link>

      {/* Fixed-height footer, pinned to the bottom (mt-auto). pb-0 on the card → this is exactly the zone between
          the divider and the border, content vertically centered. Same height across all cards (links or not). */}
      <div className="mt-auto flex h-12 items-center justify-between gap-2 border-t border-border">
        <div className="flex min-w-0 items-center gap-1">
          {links.length > 0 ? (
            <>
              {shownLinks.map((l) => (
                <a
                  key={l.url}
                  href={l.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={platformDef(l.platform)?.label ?? l.platform}
                  aria-label={platformDef(l.platform)?.label ?? l.platform}
                  className="flex h-6 w-6 items-center justify-center rounded-md text-fg-muted transition-colors hover:bg-surface-raised hover:text-fg"
                >
                  <PlatformIcon platform={l.platform} className="h-4 w-4" />
                </a>
              ))}
              {hiddenLinks > 0 ? (
                <Link
                  href={`/c/${card.handle}`}
                  title={`${hiddenLinks} more — on the realm page`}
                  aria-label={`${hiddenLinks} more links on the realm page`}
                  className="flex h-6 items-center justify-center rounded-md px-1.5 text-small leading-none text-fg-muted transition-colors hover:bg-surface-raised hover:text-fg"
                >
                  …
                </Link>
              ) : null}
            </>
          ) : (
            <span className="text-small text-fg-muted">no links</span>
          )}
        </div>
        <a
          href={explorerAddressUrl(card.payoutAddress)}
          target="_blank"
          rel="noopener noreferrer"
          title="Payout address in Solana Explorer"
          className="mono flex shrink-0 items-center gap-1 text-small text-fg-muted transition-colors hover:text-fg"
        >
          {shortAddress(card.payoutAddress)} ↗
        </a>
      </div>
    </div>
  );
}
