"use client";

import { cn } from "@/lib/utils";
import { Button } from "./button";

/** Loading placeholder. Its shape should match the final content (no layout shift). */
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("skeleton-shimmer rounded", className)} />;
}

/** Empty state — an invitation to act (components.md §1). */
export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border bg-[var(--bg)] px-6 py-12 text-center">
      <h3 className="text-h3 text-fg">{title}</h3>
      {description ? <p className="max-w-md text-small text-fg-muted">{description}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

/** Error — what happened + how to fix it + "Retry" (no apologizing, no vagueness). */
export function ErrorState({
  title = "Something went wrong",
  description,
  onRetry,
}: {
  title?: string;
  description?: string;
  onRetry?: () => void;
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-danger bg-danger-bg px-6 py-12 text-center">
      <h3 className="text-h3 text-fg">{title}</h3>
      {description ? <p className="max-w-md text-small text-fg-muted">{description}</p> : null}
      {onRetry ? (
        <Button variant="secondary" size="sm" onClick={onRetry}>
          Retry
        </Button>
      ) : null}
    </div>
  );
}
