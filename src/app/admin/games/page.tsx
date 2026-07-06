"use client";

import { useMemo } from "react";
import { useQueries } from "@tanstack/react-query";
import { ErrorState, Skeleton } from "@/components/ui/feedback";
import { GAMES } from "@/games/registry";
import type { EscrowTask } from "@/games/escrow-task/types";
import { useData } from "@/lib/data/context";
import { useDiscovery } from "@/lib/data/hooks";
import type { ChannelConfig } from "@/lib/data/types";
import { fromMicro } from "@/lib/utils";

function usd(micro: bigint): string {
  return "$" + Math.round(fromMicro(micro)).toLocaleString("en-US");
}

const STATUS_LABEL: Record<EscrowTask["status"], string> = {
  PENDING: "Pending",
  ACCEPTED: "Accepted",
  DONE: "Delivered",
  DISPUTED: "Disputed",
  RESOLVED: "Resolved",
};
const STATUS_ORDER: EscrowTask["status"][] = ["PENDING", "ACCEPTED", "DONE", "DISPUTED", "RESOLVED"];

/**
 * Admin → Mini-games. Platform-wide stats: catalog (GAMES registry), reach (how many realms enabled
 * each game — from configs), and escrow-task activity (tasks by status + money). No data? We show
 * honest zeros — no fakes (mini-games are enabled by streamers, ADR 0016).
 */
export default function AdminGamesPage() {
  const provider = useData();
  const { data, isLoading, error, refetch } = useDiscovery();
  const realms = useMemo(() => data?.items ?? [], [data]);

  // Each realm's config → enabledGames (reach). Same key as useChannelConfig → React Query dedupes it.
  const configQs = useQueries({
    queries: realms.map((r) => ({
      queryKey: ["channelConfig", r.channelId] as const,
      queryFn: () => provider.getChannelConfig(r.channelId),
      staleTime: 30_000,
    })),
  });
  // Each realm's escrow-tasks (op:"list"). Key matches useEscrowTasks → dedup.
  const taskQs = useQueries({
    queries: realms.map((r) => ({
      queryKey: ["game", "escrow-task", r.channelId] as const,
      queryFn: () =>
        provider.gameQuery({ gameId: "escrow-task", channelId: r.channelId, op: "list" }) as Promise<{
          tasks: EscrowTask[];
        }>,
      staleTime: 30_000,
    })),
  });

  const loading = isLoading || configQs.some((q) => q.isLoading) || taskQs.some((q) => q.isLoading);

  const s = useMemo(() => {
    const configs = configQs.map((q) => q.data).filter(Boolean) as ChannelConfig[];
    const tasks = taskQs.flatMap((q) => q.data?.tasks ?? []);
    const realmsWithGames = configs.filter((c) => (c.enabledGames?.length ?? 0) > 0).length;
    const adoption = GAMES.map((g) => ({
      key: g.id,
      label: g.title + (g.status === "building" ? " · in dev" : ""),
      value: configs.filter((c) => c.enabledGames?.includes(g.id)).length,
    }));
    const byStatus = STATUS_ORDER.map((st) => ({
      key: st,
      label: STATUS_LABEL[st],
      value: tasks.filter((t) => t.status === st).length,
    }));
    const totalValue = tasks.reduce((acc, t) => acc + BigInt(t.amount), 0n);
    const lockedValue = tasks
      .filter((t) => t.status !== "RESOLVED")
      .reduce((acc, t) => acc + BigInt(t.amount), 0n);
    const resolved = tasks.filter((t) => t.resolution);
    return {
      taskCount: tasks.length,
      realmsWithGames,
      adoption,
      byStatus,
      totalValue,
      lockedValue,
      disputes: tasks.filter((t) => t.status === "DISPUTED").length,
      toStreamer: resolved.filter((t) => t.resolution?.outcome === "to_streamer").length,
      toDonor: resolved.filter((t) => t.resolution?.outcome === "to_donor").length,
    };
  }, [configQs, taskQs]);

  const available = GAMES.filter((g) => g.status !== "building").length;
  const building = GAMES.length - available;

  return (
    <div className="flex flex-col gap-6 pb-10">
      <div className="flex flex-col gap-1">
        <h1 className="text-display-l text-fg">Mini-games</h1>
        <p className="text-fg-muted">Adoption and escrow-task activity across every realm.</p>
      </div>

      {loading ? (
        <Skeleton className="h-64 w-full rounded-lg" />
      ) : error ? (
        <ErrorState description="Couldn't load mini-games stats." onRetry={() => refetch()} />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatCard
              label="Games in catalog"
              value={String(GAMES.length)}
              sub={`${available} live · ${building} in dev`}
            />
            <StatCard
              label="Realms with games on"
              value={String(s.realmsWithGames)}
              sub={`of ${realms.length} realms`}
            />
            <StatCard label="Escrow tasks" value={String(s.taskCount)} sub={`${s.disputes} disputed`} />
            <StatCard
              label="Value in escrow"
              value={usd(s.lockedValue)}
              sub={`${usd(s.totalValue)} all-time`}
              tone="money"
            />
          </div>

          <Section title="Adoption by game" hint="How many realms have each game turned on.">
            <BarList rows={s.adoption} />
          </Section>

          <Section
            title="Escrow tasks by status"
            hint={
              s.taskCount > 0
                ? `${s.toStreamer} paid to streamer · ${s.toDonor} refunded to supporter`
                : "No escrow tasks yet — streamers enable games per realm."
            }
          >
            <BarList rows={s.byStatus} />
          </Section>
        </>
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "money";
}) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-border bg-surface px-4 py-3">
      <span className="text-caption text-fg-faint">{label}</span>
      <span
        className={
          "font-display text-xl font-semibold " + (tone === "money" ? "text-money" : "text-fg")
        }
      >
        {value}
      </span>
      {sub ? <span className="text-caption text-fg-faint">{sub}</span> : null}
    </div>
  );
}

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-5">
      <div className="flex flex-col gap-0.5">
        <h2 className="text-h3 text-fg">{title}</h2>
        {hint ? <p className="text-caption text-fg-faint">{hint}</p> : null}
      </div>
      {children}
    </section>
  );
}

function BarList({ rows }: { rows: { key: string; label: string; value: number }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className="flex flex-col gap-2.5">
      {rows.map((r) => (
        <div key={r.key} className="flex items-center gap-3">
          <span className="w-36 shrink-0 truncate text-small text-fg-muted">{r.label}</span>
          <div className="h-2 flex-1 overflow-hidden rounded-pill bg-[var(--bg)]">
            <div
              className="h-full rounded-pill bg-status"
              style={{ width: `${(r.value / max) * 100}%` }}
            />
          </div>
          <span className="mono w-8 shrink-0 text-right text-small text-fg">{r.value}</span>
        </div>
      ))}
    </div>
  );
}
