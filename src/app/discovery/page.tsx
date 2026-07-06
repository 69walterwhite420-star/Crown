"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { ChannelBrowser } from "@/components/domain/channel-browser";
import { AppHeader } from "@/components/layout/app-header";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/feedback";
import { useDiscovery } from "@/lib/data/hooks";

// Каталог каналов. С главной (`/`) понижен сюда (ADR 0018): discovery — «на выходе/в простое», не на входе.
export default function DiscoveryPage() {
  return (
    <>
      <AppHeader />
      <main className="mx-auto flex max-w-content flex-col gap-6 px-4 py-8">
        <h1 className="text-display-l text-fg">Realms</h1>
        <Suspense fallback={<Skeleton className="h-28 w-full rounded-lg" />}>
          <DiscoveryList />
        </Suspense>
      </main>
    </>
  );
}

/** Использует useSearchParams (?q из поиска в шапке) → отдельный компонент под Suspense. */
function DiscoveryList() {
  const query = useSearchParams().get("q") ?? "";
  const { data, isLoading, error, refetch } = useDiscovery();

  if (isLoading) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-28 w-full rounded-lg" />
        ))}
      </div>
    );
  }
  if (error) {
    return <ErrorState description="Couldn't load realms." onRetry={() => refetch()} />;
  }
  if (!data || data.items.length === 0) {
    return (
      <EmptyState
        title="No realms yet"
        description="Connect wallet and activate your realm so it shows up here."
      />
    );
  }
  // key={query} — при новом поиске из шапки ремоунтим со свежим начальным запросом.
  return <ChannelBrowser key={query} channels={data.items} initialQuery={query} />;
}
