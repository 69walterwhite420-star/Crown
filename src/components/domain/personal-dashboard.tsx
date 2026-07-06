"use client";

import Link from "next/link";
import { Monogram } from "@/components/domain/header-actions";
import { RankBadge } from "@/components/domain/rank-badge";
import { CrownLogo } from "@/components/crown-logo";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/feedback";
import { useDonorOverview, useHomeFeed } from "@/lib/data/hooks";
import type { Donation, DonorChannelStanding, DonorOverview, OpenCycle } from "@/lib/data/types";
import { rankOf, rankProgress, timeAgoEn } from "@/lib/crown";
import { channelHue, collapseWhitespace, fromMicro, shortAddress } from "@/lib/utils";

/** Whole-dollar format for aggregates: "$12,480". */
function usd(micro: bigint): string {
  return "$" + Math.round(fromMicro(micro)).toLocaleString("en-US");
}
function points(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}
function monthYear(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", year: "numeric" });
}

/**
 * Личный дашборд донатера: Reign, дворы и активность. Самодостаточен (тянет overview по адресу). Раздел
 * «Dashboard» личного пространства (`/space`).
 */
export function PersonalDashboard({ address }: { address: string }) {
  const overview = useDonorOverview(address);
  const home = useHomeFeed();

  if (overview.isLoading) return <Skeleton className="h-64 w-full rounded-xl" />;
  if (overview.error || !overview.data)
    return <ErrorState description="Couldn't load your realm." onRetry={() => overview.refetch()} />;

  const o = overview.data;
  const cycles = home.data?.cycles ?? [];
  const handleById = new Map(o.standings.map((s) => [s.channelId, s.handle] as const));

  if (o.donationCount === 0) {
    return (
      <EmptyState
        title="Your realm is empty"
        description="Crown a streamer to begin your Reign. Every crown is USDC that lands with them and lifts your rank in their realm."
        action={
          <Link
            href="/"
            className="rounded-lg border border-money-dim bg-money-bg/40 px-5 py-2.5 text-small font-semibold text-money transition-colors hover:border-money hover:bg-money-bg"
          >
            Browse the realms
          </Link>
        }
      />
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <PersonalHero o={o} address={address} />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Crowned" value={usd(o.totalDonated)} tone="money" />
        <StatCard label="Realms" value={String(o.channelsSupported)} />
        <StatCard label="Crowns" value={String(o.donationCount)} />
        <StatCard
          label="Highest rank"
          value={rankOf(o.topStanding?.points ?? 0).name}
          tone="rank"
          metal={rankOf(o.topStanding?.points ?? 0).metal}
        />
      </div>

      {cycles.length > 0 && (
        <section className="flex flex-col gap-4">
          <SectionHead title="Requires you" hint="Open cycles waiting on your move." />
          <div className="flex flex-col gap-3">
            {cycles.map((c) => (
              <CycleRow key={c.taskId} cycle={c} />
            ))}
          </div>
        </section>
      )}

      <section className="flex flex-col gap-4">
        <SectionHead title="Your realms" hint="Your Reign is local — separate in every realm." />
        <div className="flex flex-col gap-3">
          {o.standings.map((s) => (
            <StandingRow key={s.channelId} s={s} />
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <SectionHead title="Recent crowns" />
        <div className="flex flex-col divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface">
          {o.donations.slice(0, 8).map((d) => (
            <ActivityRow key={d.id} d={d} handle={handleById.get(d.channelId) ?? d.channelId} />
          ))}
        </div>
      </section>
    </div>
  );
}

function PersonalHero({ o, address }: { o: DonorOverview; address: string }) {
  const topPoints = o.topStanding?.points ?? 0;
  const rank = rankOf(topPoints);
  const hue = channelHue(address);
  return (
    <header className="flex flex-col">
      <div className="relative">
        <div
          className="relative h-28 w-full overflow-hidden rounded-xl border border-border sm:h-36"
          style={{
            backgroundImage: `linear-gradient(135deg, hsl(${hue} 34% 13%) 0%, hsl(${hue} 24% 7%) 55%, #000 100%)`,
          }}
        >
          <CrownLogo size={132} className="absolute -right-3 bottom-1 text-status opacity-[0.08]" />
        </div>
        <RankBadge
          points={topPoints}
          size={80}
          className="absolute -bottom-9 left-4 bg-[var(--bg)] ring-4 ring-[var(--bg)] sm:left-6"
        />
      </div>

      <div className="flex flex-col gap-1 pt-12 sm:pt-14">
        <span className="text-caption font-medium uppercase tracking-wide" style={{ color: rank.metal }}>
          {rank.name}
        </span>
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h1 className="text-display-l leading-tight text-fg">Your realm</h1>
          <span className="mono text-fg-faint">{shortAddress(address)}</span>
        </div>
        <p className="text-small text-fg-muted">
          Crowning {o.channelsSupported} {o.channelsSupported === 1 ? "realm" : "realms"}
          {o.firstDonationAt ? ` · since ${monthYear(o.firstDonationAt)}` : ""}
        </p>
      </div>
    </header>
  );
}

function StandingRow({ s }: { s: DonorChannelStanding }) {
  const { rank, next, progress, toNext } = rankProgress(s.points);
  return (
    <Link
      href={`/c/${s.handle}`}
      className="group flex items-center gap-4 rounded-xl border border-border bg-surface p-4 transition-colors hover:border-border-strong"
    >
      <RankBadge rank={rank} size={44} />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex items-baseline justify-between gap-3">
          <span className="flex min-w-0 items-baseline gap-2">
            <span className="mono shrink-0 text-fg transition-colors group-hover:text-status">
              @{s.handle}
            </span>
            {s.channelName ? (
              <span className="truncate text-small text-fg-faint">{s.channelName}</span>
            ) : null}
          </span>
          <div className="flex shrink-0 flex-col items-end leading-tight">
            <span className="mono text-status">
              {points(s.points)}
              <span className="ml-1 text-caption text-fg-faint">REIGN</span>
            </span>
            <span className="text-caption text-fg-faint">{usd(s.totalDonated)} crowned</span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="shrink-0 text-small" style={{ color: rank.metal }}>
            {rank.name}
          </span>
          <div className="h-1.5 flex-1 overflow-hidden rounded-pill bg-surface-raised">
            <div
              className="h-full rounded-pill"
              style={{
                width: `${progress * 100}%`,
                background: next
                  ? `linear-gradient(90deg, ${rank.metal}, ${next.metal})`
                  : rank.metal,
              }}
            />
          </div>
          <span className="shrink-0 text-caption text-fg-faint">
            {next ? `${points(toNext)} to ${next.name}` : "Apex rank"}
          </span>
        </div>
      </div>
    </Link>
  );
}

function ActivityRow({ d, handle }: { d: Donation; handle: string }) {
  const shown = d.message && d.message.state === "SHOWN" ? d.message.text : null;
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <Monogram name={handle} size="sm" />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex items-baseline gap-2">
          <Link href={`/c/${handle}`} className="mono text-small text-fg hover:text-status">
            @{handle}
          </Link>
          <span className="text-caption text-fg-faint">{timeAgoEn(d.ts)}</span>
        </div>
        {shown ? (
          <p className="line-clamp-2 text-small text-fg-muted">“{collapseWhitespace(shown)}”</p>
        ) : (
          <p className="text-small text-fg-faint">Silent crown</p>
        )}
      </div>
      <span className="mono flex-none text-money">{usd(d.amount)}</span>
    </div>
  );
}

function CycleRow({ cycle }: { cycle: OpenCycle }) {
  const label: Record<OpenCycle["kind"], string> = {
    claimable: "Claim your refund",
    grace: "Cancel window open",
    dispute_window: "Dispute window open",
    voting: "Vote in progress",
    awaiting: "Awaiting delivery",
  };
  return (
    <Link
      href={`/c/${cycle.channelHandle}/dispute/${encodeURIComponent(cycle.taskId)}`}
      className="flex items-center gap-4 rounded-xl border border-border bg-surface p-4 transition-colors hover:border-border-strong"
    >
      <span
        className={`h-2 w-2 flex-none rounded-full ${cycle.actionable ? "bg-money" : "bg-fg-faint"}`}
        aria-hidden
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="text-small text-fg">{label[cycle.kind]}</span>
        <span className="mono text-caption text-fg-faint">@{cycle.channelHandle}</span>
      </div>
      <span className="mono flex-none text-money">{usd(cycle.amount)}</span>
    </Link>
  );
}

function SectionHead({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex flex-col gap-1 border-b border-border pb-3">
      <h2 className="text-h3 text-fg">{title}</h2>
      {hint && <p className="text-small text-fg-faint">{hint}</p>}
    </div>
  );
}

function StatCard({
  label,
  value,
  tone,
  metal,
}: {
  label: string;
  value: string;
  tone?: "money" | "rank";
  metal?: string;
}) {
  const cls = tone === "money" ? "text-money" : tone === "rank" ? "" : "text-fg";
  return (
    <div className="flex flex-col gap-1 rounded-xl border border-border bg-surface px-4 py-3">
      <span className="text-caption uppercase tracking-wide text-fg-faint">{label}</span>
      <span
        className={`font-display text-xl font-semibold ${cls}`}
        style={tone === "rank" && metal ? { color: metal } : undefined}
      >
        {value}
      </span>
    </div>
  );
}
