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
 * Search a crown by: name (donor address), hash (transaction signature), message text (if available — for
 * shown-public ones, and for everything if you manage the realm), amount and id. Case-insensitive substring.
 */
function matches(d: Donation, q: string): boolean {
  if (!q) return true;
  const hay = [
    d.donor, // donor address
    d.donorName ?? "", // name (display name)
    d.txSignature ?? "", // transaction hash
    d.message?.text ?? "",
    d.id,
    String(fromMicro(d.amount)),
  ]
    .join(" ")
    .toLowerCase();
  return hay.includes(q);
}

/**
 * A list of crowns with search and pagination (page size is selectable). Data is client-side.
 * COLLAPSIBLE (native <details>): collapsed by default, the header-button shows the counter.
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
  reportable?: boolean; // show "Report" on shown messages (for the public feed)
  manageChannelId?: string; // set → each crown gets a "Ban" button (realm owner/moderator)
  collapsible?: boolean; // false → no collapsing (e.g. in realm tabs — redundant there), always expanded
  plain?: boolean; // "airy" feed: no search/pagination/border, a section heading, rows with dividers
}) {
  const [query, setQuery] = useState("");
  const [pageSize, setPageSize] = useState(25);
  const [page, setPage] = useState(0);

  const q = query.trim().toLowerCase();
  const filtered = useMemo(() => donations.filter((d) => matches(d, q)), [donations, q]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, pageCount - 1); // the filter may have shortened the list → don't get stuck on an empty page.
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

  // "Airy" feed (realm page): a section heading + rows with dividers, no search/pagination/border.
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

  // Non-collapsible (e.g. in realm tabs) — a section heading + content, no card border (airy style).
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
