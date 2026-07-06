"use client";

import { useMemo, useState } from "react";
import { DonationCard } from "./donation-card";
import { EmptyState } from "@/components/ui/feedback";
import { ExpandingSearch } from "@/components/ui/expanding-search";
import { Pager, usePager } from "@/components/ui/pager";
import { TaskFeedRow } from "@/games/escrow-task/EscrowTaskPanel";
import type { EscrowTask } from "@/games/escrow-task/types";
import { useLeaderboard, useSession } from "@/lib/data/hooks";
import type { Donation, Tier } from "@/lib/data/types";
import { fromMicro } from "@/lib/utils";

type FeedItem =
  | { kind: "donation"; key: string; ts: number; hay: string; d: Donation }
  | { kind: "task"; key: string; ts: number; hay: string; t: EscrowTask };

const donationHay = (d: Donation): string =>
  [d.donor, d.donorName ?? "", d.txSignature ?? "", d.message?.text ?? "", d.id, String(fromMicro(d.amount))]
    .join(" ")
    .toLowerCase();

const taskHay = (t: EscrowTask): string =>
  [t.donor, t.text, t.fundTx ?? "", t.id, String(fromMicro(BigInt(t.amount))), t.status, t.resolution?.outcome ?? ""]
    .join(" ")
    .toLowerCase();

/**
 * Единая лента двора: обычные донаты + донаты-с-заданиями (игры) в ОДНОМ таймлайне по времени. Каждый ряд —
 * аватар донора, ник + локальный тир, сумма, текст (если показан), время. Поиск — растущая лупа; пагинация
 * появляется только когда донатов много (Pager сам прячется). Тир донора берём из лидерборда (дедуп-запрос).
 */
export function ChannelFeed({
  donations,
  tasks,
  handle,
  channelId,
  reportable = false,
  manageChannelId,
}: {
  donations: Donation[];
  tasks: EscrowTask[];
  handle: string; // для ссылки на детали спора задания (/c/<handle>/dispute/<taskId>)
  channelId?: string; // для тир-бейджей донаторов (лидерборд); опц. — без него просто без бейджей
  reportable?: boolean; // «Пожаловаться» на показанных сообщениях
  manageChannelId?: string; // задан → «Забанить» донора (владелец/модератор)
}) {
  const viewer = useSession().data?.address ?? null; // для «Пожаловаться» на заданиях
  const [query, setQuery] = useState("");

  // Локальный тир донора (для бейджа в ленте) — из лидерборда канала. Тот же ключ, что и полная страница
  // донатёров/Realm roll → React Query дедупит запрос.
  const board = useLeaderboard(channelId, "all_time").data;
  const tierByDonor = useMemo(() => {
    const m = new Map<string, Tier>();
    for (const e of board ?? []) if (e.tier) m.set(e.donor, e.tier);
    return m;
  }, [board]);

  const items = useMemo<FeedItem[]>(() => {
    const ds = donations.map<FeedItem>((d) => ({
      kind: "donation",
      key: `d:${d.id}`,
      ts: Date.parse(d.ts),
      hay: donationHay(d),
      d,
    }));
    const ts = tasks
      .filter((t) => !t.hidden) // отклонённые стримером не показываем в ленте (вернутся донору по таймеру)
      .map<FeedItem>((t) => ({
        kind: "task",
        key: `t:${t.id}`,
        ts: Date.parse(t.createdAt),
        hay: taskHay(t),
        t,
      }));
    return [...ds, ...ts].sort((a, b) => b.ts - a.ts); // новее сверху
  }, [donations, tasks]);

  const q = query.trim().toLowerCase();
  const filtered = useMemo(() => (q ? items.filter((it) => it.hay.includes(q)) : items), [items, q]);
  const pager = usePager(filtered, 25);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <span className="text-caption uppercase tracking-wide text-fg-faint">
          Crowns · {items.length}
        </span>
        {items.length > 0 ? (
          <ExpandingSearch
            value={query}
            onChange={(v) => {
              setQuery(v);
              pager.setPage(0);
            }}
            placeholder="name, hash, text, amount…"
            label="Search feed"
          />
        ) : null}
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          title="Nothing found"
          description={query ? "Try a different search." : "No crowns yet."}
        />
      ) : (
        <>
          <div className="flex flex-col [&>:last-child]:border-b-0">
            {pager.pageItems.map((it) =>
              it.kind === "donation" ? (
                <DonationCard
                  key={it.key}
                  donation={it.d}
                  tier={tierByDonor.get(it.d.donor)}
                  variant="row"
                  avatar
                  reportable={reportable}
                  manageChannelId={manageChannelId}
                />
              ) : (
                <TaskFeedRow
                  key={it.key}
                  task={it.t}
                  handle={handle}
                  viewer={viewer}
                  manageChannelId={manageChannelId}
                />
              ),
            )}
          </div>
          <Pager {...pager} />
        </>
      )}
    </div>
  );
}
