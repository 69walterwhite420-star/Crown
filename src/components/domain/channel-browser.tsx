"use client";

import { useMemo, useState } from "react";
import { ChannelCardTile } from "./channel-card";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/feedback";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import type { ChannelCard } from "@/lib/data/types";

const PAGE_SIZES = [6, 12, 24, 48];

/** Поиск по каналу: хэндл, отображаемое имя, верхний тир. Регистронезависимая подстрока. */
function matches(c: ChannelCard, q: string): boolean {
  if (!q) return true;
  return [c.handle, c.displayName ?? "", c.topTierName].join(" ").toLowerCase().includes(q);
}

/** Сетка карточек каналов с поиском и постраничной разбивкой. Сами карточки остаются прежними. */
export function ChannelBrowser({
  channels,
  initialQuery = "",
}: {
  channels: ChannelCard[];
  initialQuery?: string;
}) {
  const [query, setQuery] = useState(initialQuery);
  const [pageSize, setPageSize] = useState(12);
  const [page, setPage] = useState(0);

  const q = query.trim().toLowerCase();
  const filtered = useMemo(() => channels.filter((c) => matches(c, q)), [channels, q]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, pageCount - 1);
  const start = safePage * pageSize;
  const pageItems = filtered.slice(start, start + pageSize);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <div className="flex-1">
          <Input
            label="Поиск канала"
            placeholder="хэндл, имя, тир…"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(0);
            }}
          />
        </div>
        <Select
          label="На странице"
          value={String(pageSize)}
          onChange={(e) => {
            setPageSize(Number(e.target.value));
            setPage(0);
          }}
          className="sm:w-28"
        >
          {PAGE_SIZES.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </Select>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          title="Ничего не найдено"
          description={query ? "Измени запрос поиска." : "Пока нет каналов."}
        />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3">
            {pageItems.map((c) => (
              <ChannelCardTile key={c.channelId} card={c} />
            ))}
          </div>
          <div className="flex items-center justify-between gap-2 text-small text-fg-faint">
            <span>Всего: {filtered.length}</span>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                disabled={safePage <= 0}
                onClick={() => setPage(safePage - 1)}
              >
                ← Назад
              </Button>
              <span className="mono">
                {safePage + 1} / {pageCount}
              </span>
              <Button
                variant="ghost"
                size="sm"
                disabled={safePage >= pageCount - 1}
                onClick={() => setPage(safePage + 1)}
              >
                Вперёд →
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
