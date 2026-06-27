"use client";

import { TierBadge } from "./standing";
import { resolveTier } from "@/lib/reputation";
import type { Tier } from "@/lib/data/types";
import { cn, formatPoints } from "@/lib/utils";

/** Живой «дофаминовый» предпросмотр standing в форме доната: ввёл сумму → видно, сколько очков получишь и
 *  как двинется тир. gain = очки за текущую сумму (pointsForAmount), 0 — если сумма не введена. */
export type PreviewVariant = 1 | 2 | 3;

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

export function StandingPreview({
  variant,
  currentPoints,
  gain,
  tiers,
}: {
  variant: PreviewVariant;
  currentPoints: number;
  gain: number;
  tiers: Tier[];
}) {
  const newPoints = currentPoints + gain;
  const before = resolveTier(currentPoints, tiers);
  const after = resolveTier(newPoints, tiers);
  const tierUp = gain > 0 && after.tier.name !== before.tier.name;
  const active = gain > 0;

  if (variant === 2) {
    return (
      <div
        className="flex flex-col items-center gap-1 rounded-lg border p-4 text-center transition-colors"
        style={{ borderColor: active ? "var(--money)" : "var(--border)" }}
      >
        <span className="text-small text-fg-muted">{active ? "ты получишь" : "за донат начислим"}</span>
        <span
          key={gain}
          className={cn("mono font-display text-display-l leading-none text-money", active && "animate-stamp")}
        >
          +{formatPoints(gain)}
        </span>
        <span className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-small text-fg-faint">
          станет <span className="mono text-fg">{formatPoints(newPoints)}</span> очков
          <TierBadge tier={after.tier} />
        </span>
        {tierUp ? (
          <span className="mt-0.5 text-small font-medium text-status">
            ↑ новый тир «{after.tier.name}»
          </span>
        ) : null}
      </div>
    );
  }

  if (variant === 3) {
    return (
      <div
        className="flex flex-col gap-1 rounded-lg border-2 p-4 transition-colors"
        style={{ borderColor: after.tier.color, boxShadow: `inset 0 0 0 1px ${after.tier.color}33` }}
      >
        <span className="text-caption" style={{ color: after.tier.color }}>
          {after.tier.name}
          {tierUp ? " · новый!" : ""}
        </span>
        <div className="flex items-baseline gap-2">
          <span className="mono text-display-l leading-none" style={{ color: after.tier.color }}>
            {formatPoints(newPoints)}
          </span>
          {active ? <span className="mono text-small text-money">+{formatPoints(gain)}</span> : null}
        </div>
        <span className="text-small text-fg-faint">
          {active ? "очков standing после доната" : "очков standing сейчас"}
        </span>
      </div>
    );
  }

  // Вариант 1 — полоска к следующему тиру с «призрачным» прогнозом.
  const next = before.nextTier;
  const span = next ? Math.max(1, next.threshold - before.tier.threshold) : 1;
  const curFrac = next ? clamp01((currentPoints - before.tier.threshold) / span) : 1;
  const projFrac = next ? clamp01((newPoints - before.tier.threshold) / span) : 1;
  return (
    <div
      className="flex flex-col gap-2 rounded-lg border p-3 transition-colors"
      style={{ borderColor: active ? "var(--money)" : "var(--border)" }}
    >
      <div className="flex items-center justify-between gap-2 text-small">
        <span className="flex items-center gap-2">
          <TierBadge tier={after.tier} />
          {tierUp ? <span className="font-medium text-status">новый тир!</span> : null}
        </span>
        <span className="mono text-money">+{formatPoints(gain)} очков</span>
      </div>
      <div className="relative h-2.5 overflow-hidden rounded-pill bg-surface-raised">
        <div
          className="absolute inset-y-0 left-0 rounded-pill transition-all duration-300 ease-ease"
          style={{ width: `${projFrac * 100}%`, backgroundColor: "var(--money)", opacity: 0.35 }}
        />
        <div
          className="absolute inset-y-0 left-0 rounded-pill transition-all duration-300 ease-ease"
          style={{ width: `${curFrac * 100}%`, backgroundColor: "var(--money)" }}
        />
      </div>
      <div className="flex items-center justify-between gap-2 text-small text-fg-faint">
        <span>{next ? `до «${next.name}»` : "максимальный тир"}</span>
        <span className="mono">
          {formatPoints(currentPoints)} → <span className="text-fg">{formatPoints(newPoints)}</span>
        </span>
      </div>
    </div>
  );
}
