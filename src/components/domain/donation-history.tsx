"use client";

import { useMemo, useState } from "react";
import { DonationCard } from "./donation-card";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/feedback";
import { ChevronLeftIcon, ChevronRightIcon, SearchIcon } from "@/components/ui/icons";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { fromMicro } from "@/lib/utils";
import type { Donation } from "@/lib/data/types";

const PAGE_SIZES = [10, 25, 50, 100];

/**
 * Поиск по донату: ник (адрес донора), хеш (подпись транзакции), текст сообщения (если доступен — у
 * показанных публично, у всех — для менеджера канала), сумма и id. Регистронезависимая подстрока.
 */
function matches(d: Donation, q: string): boolean {
  if (!q) return true;
  const hay = [
    d.donor, // адрес донора
    d.donorName ?? "", // ник (отображаемое имя)
    d.txSignature ?? "", // хеш транзакции
    d.message?.text ?? "",
    d.id,
    String(fromMicro(d.amount)),
  ]
    .join(" ")
    .toLowerCase();
  return hay.includes(q);
}

/**
 * Список донатов с поиском и постраничной разбивкой (размер страницы выбирается). Данные — на клиенте.
 * СВОРАЧИВАЕМЫЙ (нативный <details>): по умолчанию свёрнут, заголовок-кнопка показывает счётчик.
 */
export function DonationHistory({
  donations,
  title = "Crown history",
  defaultOpen = false,
  reportable = false,
  manageChannelId,
  collapsible = true,
  plain = false,
}: {
  donations: Donation[];
  title?: string;
  defaultOpen?: boolean;
  reportable?: boolean; // показывать «Пожаловаться» на показанных сообщениях (для публичной ленты)
  manageChannelId?: string; // задан → у каждого доната кнопка «Забанить» (владелец/модератор канала)
  collapsible?: boolean; // false → без сворачивания (напр. в табах канала — там это уже лишнее), всегда раскрыт
  plain?: boolean; // «воздушная» лента: без поиска/пагинации/рамки, заголовок-секция, строки с разделителями
}) {
  const [query, setQuery] = useState("");
  const [pageSize, setPageSize] = useState(25);
  const [page, setPage] = useState(0);

  const q = query.trim().toLowerCase();
  const filtered = useMemo(() => donations.filter((d) => matches(d, q)), [donations, q]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, pageCount - 1); // фильтр мог укоротить список → не зависаем на пустой стр.
  const start = safePage * pageSize;
  const pageItems = filtered.slice(start, start + pageSize);

  const sectionTitle = (
    <span className="text-caption uppercase tracking-wide text-fg-faint">
      {title} · {donations.length}
    </span>
  );

  const body = (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <div className="flex-1">
          <Input
            label="Search"
            icon={<SearchIcon className="h-4 w-4" />}
            placeholder="name, transaction hash, text, amount…"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(0);
            }}
          />
        </div>
        <Select
          label="Per page"
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
          title="Nothing found"
          description={query ? "Try a different search." : "No crowns yet."}
        />
      ) : (
        <>
          <div className="flex flex-col [&>:last-child]:border-b-0">
            {pageItems.map((d) => (
              <DonationCard
                key={d.id}
                donation={d}
                variant="row"
                reportable={reportable}
                manageChannelId={manageChannelId}
              />
            ))}
          </div>
          <div className="flex items-center justify-between gap-2 text-small text-fg-faint">
            <span>Total: {filtered.length}</span>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                disabled={safePage <= 0}
                onClick={() => setPage(safePage - 1)}
              >
                <ChevronLeftIcon className="h-4 w-4" />
                Back
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
                Next
                <ChevronRightIcon className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );

  // «Воздушная» лента (страница канала): заголовок-секция + строки с разделителями, без поиска/пагинации/рамки.
  if (plain) {
    return (
      <div className="flex flex-col gap-2">
        <div className="text-caption uppercase tracking-wide text-fg-faint">
          {title} · {donations.length}
        </div>
        {donations.length === 0 ? (
          <p className="py-6 text-center text-small text-fg-faint">No shown messages yet.</p>
        ) : (
          <div className="flex flex-col [&>:last-child]:border-b-0">
            {donations.map((d) => (
              <DonationCard
                key={d.id}
                donation={d}
                variant="row"
                reportable={reportable}
                manageChannelId={manageChannelId}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  // Несворачиваемо (напр. в табах канала) — заголовок-секция + контент, без рамки-карточки (airy-стиль).
  if (!collapsible) {
    return (
      <div className="flex flex-col gap-3">
        {sectionTitle}
        {body}
      </div>
    );
  }

  return (
    <details className="group flex flex-col gap-3" open={defaultOpen}>
      <summary className="flex cursor-pointer list-none items-center justify-between [&::-webkit-details-marker]:hidden">
        {sectionTitle}
        <span className="text-small text-fg-muted transition-transform group-open:rotate-180">▾</span>
      </summary>
      <div className="mt-3">{body}</div>
    </details>
  );
}
