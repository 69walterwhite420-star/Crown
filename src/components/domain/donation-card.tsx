import Link from "next/link";
import { Amount } from "./amount";
import { Monogram } from "./header-actions";
import { ModerationMenu } from "./moderation-menu";
import { ReportDialog } from "./report-dialog";
import { TierBadge } from "./standing";
import { ExternalLinkIcon } from "@/components/ui/icons";
import { explorerTxUrl } from "@/lib/chain/addresses";
import { collapseWhitespace, shortAddress, timeAgo } from "@/lib/utils";
import type { Donation, Tier } from "@/lib/data/types";

/** Карточка доната: донор, бейдж тира, сумма, текст (если SHOWN), время. Лента канала и история /me.
 *  variant="card" (по умолчанию) — в рамке; variant="row" — без рамки, с нижним разделителем (лента канала).
 *  avatar (только row) — вести монограмму донора слева (лента двора). */
export function DonationCard({
  donation,
  tier,
  displayName,
  showChannel,
  reportable,
  manageChannelId,
  variant = "card",
  avatar = false,
}: {
  donation: Donation;
  tier?: Tier;
  displayName?: string;
  showChannel?: boolean;
  reportable?: boolean; // показать «Пожаловаться» (публичная лента показанных сообщений)
  manageChannelId?: string; // задан (зритель управляет каналом) → показать «Забанить» донора
  variant?: "card" | "row";
  avatar?: boolean;
}) {
  const shown = donation.message?.state === "SHOWN";
  const name = displayName ?? donation.donorName ?? shortAddress(donation.donor);

  const body = (
    <>
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <Link
            href={`/u/${donation.donor}`}
            className="truncate text-small font-medium text-fg transition-colors hover:text-status"
          >
            {name}
          </Link>
          {tier ? <TierBadge tier={tier} /> : null}
        </div>
        <Amount micro={donation.amount} className="shrink-0" />
      </div>
      {shown && donation.message ? (
        <p className="break-words text-body text-fg">{collapseWhitespace(donation.message.text)}</p>
      ) : donation.message ? (
        // Сообщение есть, но не показано (HELD/HIDDEN) — помечаем явно, а не пустой строкой.
        <p className="text-small italic text-fg-faint">[hidden]</p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2 text-caption text-fg-faint">
        <span title={donation.ts}>{timeAgo(donation.ts)}</span>
        {showChannel ? <span className="mono">· {donation.channelId}</span> : null}
        <div className="ml-auto flex items-center gap-1">
          {donation.txSignature ? (
            <a
              href={explorerTxUrl(donation.txSignature)}
              target="_blank"
              rel="noreferrer"
              className="flex h-7 w-7 items-center justify-center rounded-md text-fg-muted transition-colors hover:bg-surface-raised hover:text-fg"
              title="View transaction"
              aria-label="View transaction"
            >
              <ExternalLinkIcon className="h-4 w-4" />
            </a>
          ) : null}
          {reportable && shown && donation.message && !manageChannelId ? (
            <ReportDialog messageId={donation.message.id} channelId={donation.channelId} />
          ) : null}
          {manageChannelId ? (
            <ModerationMenu
              channelId={manageChannelId}
              donor={donation.donor}
              message={donation.message}
            />
          ) : null}
        </div>
      </div>
    </>
  );

  // Лента двора: аватар слева + колонка контента, ряд с нижним разделителем.
  if (variant === "row" && avatar) {
    return (
      <div className="flex gap-3 border-b border-border py-3.5">
        <Monogram name={name} size="md" />
        <div className="flex min-w-0 flex-1 flex-col gap-1">{body}</div>
      </div>
    );
  }

  return (
    <div
      className={
        variant === "row"
          ? "flex flex-col gap-2 border-b border-border py-4"
          : "flex flex-col gap-2 rounded border border-border bg-surface p-3"
      }
    >
      {body}
    </div>
  );
}
