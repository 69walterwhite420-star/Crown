"use client";

import { useEffect, useRef, useState } from "react";
import { Skeleton } from "@/components/ui/feedback";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { resolveTier } from "@/lib/reputation";
import { cn, formatPoints, formatPointsCompact } from "@/lib/utils";
import type { Tier, ViewerStanding } from "@/lib/data/types";

/** Compact tier badge shown next to a handle / in the feed / on the leaderboard. */
export function TierBadge({ tier, className }: { tier: Tier; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-pill border px-2 py-0.5 text-small",
        className,
      )}
      style={{ borderColor: tier.color, color: tier.color }}
    >
      <span className="h-1.5 w-1.5 rounded-pill" style={{ background: tier.color }} />
      {tier.name}
    </span>
  );
}

/**
 * The product's signature: a "minted seal of status". A viewer's standing as a dense, tactile mark
 * that visually CAN'T be bought and sold (a computed seal, not a token). Alongside it there are NEVER
 * any "transfer/sell" actions (invariant §4.3 + legal lock).
 */
export function StandingSeal({
  standing,
  fallbackTier,
  loading,
}: {
  standing?: ViewerStanding | null;
  fallbackTier?: Tier;
  loading?: boolean;
}) {
  if (loading) {
    return <Skeleton className="h-28 w-full rounded-lg" />;
  }
  const tier = standing?.tier ?? fallbackTier;
  if (!tier) return null;
  const points = standing?.points ?? 0;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          tabIndex={0}
          role="img"
          aria-label={`Reign — ${tier.name}, ${formatPoints(points)} Reign. Non-transferable.`}
          className="flex w-full cursor-help flex-col gap-1 rounded-lg border-2 bg-status-bg p-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-info"
          style={{ borderColor: tier.color, boxShadow: `inset 0 0 0 1px ${tier.color}33` }}
        >
          <span className="text-caption" style={{ color: tier.color }}>
            {tier.name}
          </span>
          <span className="mono text-display-l leading-none" style={{ color: tier.color }}>
            {formatPoints(points)}
          </span>
          <span className="text-small" style={{ color: tier.color, opacity: 0.85 }}>
            Reign
          </span>
        </div>
      </TooltipTrigger>
      <TooltipContent>
        Reign can&apos;t be bought or transferred — it&apos;s computed from your crowns to this realm.
      </TooltipContent>
    </Tooltip>
  );
}

/** Progress to the next tier (0..1) + "N points remaining". */
export function ReputationProgress({ standing }: { standing: ViewerStanding }) {
  if (!standing.nextTier) return null; // top tier — no separate bar
  const remaining = Math.max(0, standing.nextTier.threshold - standing.points);
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between text-small text-fg-muted">
        <span>to {standing.nextTier.name}</span>
        <span className="mono">{formatPoints(remaining)} Reign</span>
      </div>
      <div className="h-2 overflow-hidden rounded-pill bg-surface-raised">
        <div
          className="h-full rounded-pill"
          style={{
            width: `${Math.round(standing.progressToNext * 100)}%`,
            background: standing.nextTier.color,
          }}
        />
      </div>
    </div>
  );
}

/** Gray-green — the forecast color for "what you'll get from a crown" (distinct from the bright --money). */
const PREVIEW_COLOR = "#6e9c86";
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

/**
 * A smooth "roll" of a number from its current value to target (requestAnimationFrame, easeOutCubic). When
 * target changes, the animation continues from the already-shown value. Respects prefers-reduced-motion.
 */
function useCountUp(target: number, duration = 650): number {
  const [value, setValue] = useState(target);
  const valueRef = useRef(target);

  useEffect(() => {
    const from = valueRef.current;
    const to = target;
    if (from === to) return;

    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      valueRef.current = to;
      setValue(to);
      return;
    }

    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      const v = Math.round(from + (to - from) * eased);
      valueRef.current = v;
      setValue(v);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);

  return value;
}

/**
 * A concise standing headline — no "card within a card": label, points count and tier badge right on
 * the parent's background. With a preview: enter an amount (gain > 0) → the number "rolls" to the forecast,
 * and the bar smoothly extends in gray-green to "what you'll get". Below — progress to the next tier or a hint.
 */
export function StandingHeadline({
  standing,
  tiers,
  gain = 0,
  loading,
}: {
  standing?: ViewerStanding | null;
  tiers: Tier[];
  gain?: number;
  loading?: boolean;
}) {
  const currentPoints = standing?.points ?? 0;
  const newPoints = currentPoints + gain;
  const rolled = useCountUp(newPoints); // hook — always before the early return

  if (loading) return <Skeleton className="h-20 w-full rounded-lg" />;
  if (tiers.length === 0) return null;

  const active = gain > 0;
  const cur = resolveTier(currentPoints, tiers);
  const proj = resolveTier(newPoints, tiers);
  const tier = active ? proj.tier : cur.tier; // while typing, show the tier you'll land in (or none)
  const isNew = !standing;

  const next = cur.nextTier;
  const floor = cur.tier?.threshold ?? 0; // "no tier" → progress floor = 0
  const span = next ? Math.max(1, next.threshold - floor) : 1;
  const curFrac = next ? clamp01((currentPoints - floor) / span) : 1;
  const projFrac = next ? clamp01((newPoints - floor) / span) : 1;
  const remaining = next ? Math.max(0, next.threshold - newPoints) : 0;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-end justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="text-caption text-fg-faint">My Reign</span>
          <span className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
            <span className="mono max-w-full break-all text-h1 leading-none text-fg">
              {formatPointsCompact(rolled)}
            </span>
            <span className="text-small text-fg-muted">Reign</span>
            {active ? (
              <span className="mono text-small font-medium" style={{ color: PREVIEW_COLOR }}>
                +{formatPointsCompact(gain)}
              </span>
            ) : null}
          </span>
        </div>
        {tier ? (
          <TierBadge tier={tier} className="shrink-0" />
        ) : (
          <span className="shrink-0 text-small text-fg-faint">No tier</span>
        )}
      </div>

      {next ? (
        <div className="flex flex-col gap-1.5">
          <div className="relative h-2 overflow-hidden rounded-pill bg-surface-raised">
            {/* forecast — gray-green, smoothly extends as an amount is entered */}
            <div
              className="absolute inset-y-0 left-0 rounded-pill transition-[width] duration-700 ease-ease"
              style={{ width: `${projFrac * 100}%`, backgroundColor: PREVIEW_COLOR }}
            />
            {/* current progress — the next tier's color */}
            <div
              className="absolute inset-y-0 left-0 rounded-pill transition-[width] duration-700 ease-ease"
              style={{ width: `${curFrac * 100}%`, backgroundColor: next.color }}
            />
          </div>
          {isNew && !active ? (
            <p className="text-small text-fg-muted">
              Make your first crown to start building your Reign.
            </p>
          ) : (
            <div className="flex items-center justify-between gap-2 text-small text-fg-faint">
              <span className="truncate">to {next.name}</span>
              <span className="mono shrink-0">{formatPointsCompact(remaining)} to go</span>
            </div>
          )}
        </div>
      ) : isNew && !active ? (
        <p className="text-small text-fg-muted">
          Make your first crown to start building your Reign.
        </p>
      ) : null}
    </div>
  );
}

/** The realm's tier ladder with thresholds and perks. */
export function TierLadder({ tiers, currentTierName }: { tiers: Tier[]; currentTierName?: string }) {
  const sorted = [...tiers].sort((a, b) => a.threshold - b.threshold);
  return (
    <ul className="flex flex-col gap-2">
      {sorted.map((t) => (
        <li
          key={t.name}
          className={cn(
            "flex flex-col gap-1 rounded border border-border bg-surface px-3 py-2",
            t.name === currentTierName && "border-status",
          )}
        >
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <TierBadge tier={t} />
              {t.perks.length > 0 ? (
                <span className="text-small text-fg-faint">
                  {t.perks.map((p) => p.label).join(" · ")}
                </span>
              ) : null}
            </div>
            <span className="mono text-small text-fg-muted">{formatPoints(t.threshold)}</span>
          </div>
          {t.description?.trim() ? (
            <p className="whitespace-pre-wrap break-words text-small text-fg-muted">{t.description}</p>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
