"use client";

import { useState } from "react";
import { Button } from "./button";
import { ChevronLeftIcon, ChevronRightIcon } from "./icons";
import { Select } from "./select";

const SIZES = [10, 25, 50];

/** Local client-side list pagination. Returns the current page slice + state controls. */
export function usePager<T>(items: T[], defaultSize = 10) {
  const [pageSize, setPageSize] = useState(defaultSize);
  const [page, setPage] = useState(0);
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
  const safePage = Math.min(page, pageCount - 1); // filtering/shrinking the list → don't get stuck on an empty page
  const start = safePage * pageSize;
  return {
    pageItems: items.slice(start, start + pageSize),
    page: safePage,
    setPage,
    pageSize,
    setPageSize,
    pageCount,
    total: items.length,
  };
}

/** Pagination controls: page size + back/next + counter. Hidden when there are few items. */
export function Pager({
  page,
  pageCount,
  total,
  pageSize,
  setPage,
  setPageSize,
  sizes = SIZES,
}: {
  page: number;
  pageCount: number;
  total: number;
  pageSize: number;
  setPage: (n: number) => void;
  setPageSize: (n: number) => void;
  sizes?: number[];
}) {
  if (total <= sizes[0]!) return null; // few items — no pagination needed
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 text-small text-fg-faint">
      <span>Total: {total}</span>
      <div className="flex items-center gap-2">
        <Select
          value={String(pageSize)}
          onChange={(e) => {
            setPageSize(Number(e.target.value));
            setPage(0);
          }}
          className="w-20"
        >
          {sizes.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </Select>
        <Button variant="ghost" size="sm" disabled={page <= 0} onClick={() => setPage(page - 1)}>
          <ChevronLeftIcon className="h-4 w-4" />
          Back
        </Button>
        <span className="mono">
          {page + 1} / {pageCount}
        </span>
        <Button
          variant="ghost"
          size="sm"
          disabled={page >= pageCount - 1}
          onClick={() => setPage(page + 1)}
        >
          Next
          <ChevronRightIcon className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
