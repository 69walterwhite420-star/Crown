"use client";

import { TierBadge } from "./standing";
import { resolveTier } from "@/lib/reputation";
import type { Tier } from "@/lib/data/types";
import { formatPoints } from "@/lib/utils";

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

/**
 * Живой предпросмотр standing в форме доната: ввёл сумму → полоска «призрачным» прогнозом тянется к
 * следующему тиру. Полоска заякорена на ИТОГОВОМ тире (resolveTier(newPoints)) — поэтому на крупных
 * суммах она перескакивает на верхние уровни (бейдж и заполнение меняются на тот тир, куда попадёшь).
 */
export function StandingPreview({
  currentPoints,
  gain,
  tiers,
}: {
  currentPoints: number;
  gain: number;
  tiers: Tier[];
}) {
  const newPoints = currentPoints + gain;
  const before = resolveTier(currentPoints, tiers);
  const after = resolveTier(newPoints, tiers); // тир, в который попадёт ИТОГ → бар на него и прыгает
  const tierUp = gain > 0 && after.tier.name !== before.tier.name;
  const active = gain > 0;

  const tier = after.tier;
  const next = after.nextTier;
  const span = next ? Math.max(1, next.threshold - tier.threshold) : 1;
  const curFrac = next ? clamp01((currentPoints - tier.threshold) / span) : 1;
  const projFrac = next ? clamp01((newPoints - tier.threshold) / span) : 1;

  return (
    <div
      className="flex flex-col gap-2 rounded-lg border p-3 transition-colors"
      style={{ borderColor: active ? "var(--money)" : "var(--border)" }}
    >
      <div className="flex items-center justify-between gap-2 text-small">
        <span className="flex min-w-0 items-center gap-2">
          <TierBadge tier={tier} />
          {tierUp ? <span className="font-medium text-status">новый тир!</span> : null}
        </span>
        {active ? <span className="mono shrink-0 text-money">+{formatPoints(gain)} очков</span> : null}
      </div>

      <div className="relative h-2.5 overflow-hidden rounded-pill bg-surface-raised">
        {/* прогноз — «призрак» (тянется к projFrac); виден при любой сумме за счёт плавной анимации */}
        <div
          className="absolute inset-y-0 left-0 rounded-pill transition-[width] duration-500 ease-ease"
          style={{ width: `${projFrac * 100}%`, backgroundColor: "var(--money)", opacity: 0.45 }}
        />
        {/* текущий прогресс — сплошной */}
        <div
          className="absolute inset-y-0 left-0 rounded-pill transition-[width] duration-500 ease-ease"
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
