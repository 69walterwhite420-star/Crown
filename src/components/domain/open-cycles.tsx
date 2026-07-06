"use client";

import Link from "next/link";
import { Amount } from "./amount";
import { useHomeFeed } from "@/lib/data/hooks";
import type { OpenCycle } from "@/lib/data/types";
import { cn, collapseWhitespace } from "@/lib/utils";

/**
 * Секция «Требует тебя» — открытые циклы ВЛАДЕЛЬЦА профиля (ADR 0018), по срочности. Часть профиля-базы:
 * где ты донатил и где сейчас нужно твоё действие. Рендерить только на своём профиле (личность — из сессии,
 * §4.6: текст задания твой). Пусто → null (не показываем пустую секцию).
 */
const KIND: Record<OpenCycle["kind"], { label: string; hot: boolean }> = {
  claimable: { label: "Claim refund", hot: true },
  grace: { label: "Can cancel", hot: true },
  dispute_window: { label: "Dispute or wait", hot: true },
  voting: { label: "Voting in progress", hot: false },
  awaiting: { label: "In progress", hot: false },
};

/** Относительная подсказка по дедлайну (не тикер — пересчёт при рефетче). */
function deadlineHint(iso?: string): string {
  if (!iso) return "available now";
  const ms = Date.parse(iso) - Date.now();
  if (ms <= 0) return "expiring";
  const min = Math.round(ms / 60_000);
  if (min < 60) return `≈ ${min} ${min === 1 ? "minute" : "minutes"}`;
  const h = Math.round(min / 60);
  if (h < 48) return `≈ ${h} ${h === 1 ? "hour" : "hours"}`;
  const d = Math.round(h / 24);
  return `≈ ${d} ${d === 1 ? "day" : "days"}`;
}

function CycleCard({ c }: { c: OpenCycle }) {
  const k = KIND[c.kind];
  return (
    <Link
      href={`/c/${c.channelHandle}`}
      className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-4 transition-colors hover:border-border-strong"
    >
      <div className="flex items-center justify-between gap-3">
        <span
          className={cn(
            "rounded-pill border px-2 py-0.5 text-small",
            k.hot ? "border-money text-money" : "border-border text-fg-muted",
          )}
        >
          {k.label}
        </span>
        <Amount micro={c.amount} variant="money" />
      </div>
      <p className="line-clamp-2 text-body text-fg">{collapseWhitespace(c.text)}</p>
      <div className="flex items-center justify-between text-small text-fg-faint">
        <span className="mono">@{c.channelHandle}</span>
        <span>{deadlineHint(c.deadline)}</span>
      </div>
    </Link>
  );
}

export function OpenCycles() {
  const { data } = useHomeFeed();
  const cycles = data?.cycles ?? [];
  if (cycles.length === 0) return null;
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-h3 text-fg">Needs you</h2>
      <div className="flex flex-col gap-3">
        {cycles.map((c) => (
          <CycleCard key={c.taskId} c={c} />
        ))}
      </div>
    </section>
  );
}
