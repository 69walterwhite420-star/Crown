"use client";

import { keepPreviousData, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import dynamic from "next/dynamic";
import { useState } from "react";
import { PaletteSwitcher } from "@/components/dev/palette-switcher";
import { Toaster } from "@/components/ui/toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import { IS_CHAIN } from "@/lib/chain/addresses";
import { DataProviderProvider } from "@/lib/data/context";
import { createDataProvider } from "@/lib/data/provider";

// Chain providers — in a separate chunk (loaded only in chain mode), so the Solana stack doesn't bloat
// the mock/api bundle. ssr:false — wallet-adapter touches window.
const ChainProviders = dynamic(
  () => import("@/lib/chain/chain-providers").then((m) => m.ChainProviders),
  { ssr: false },
);

/**
 * Root providers. Selected by ENV: chain → a separate tree with the wallet; otherwise — off-chain
 * (TanStack Query + mock/api DataProvider). Components don't know which implementation is under them (CLAUDE.md §3).
 */
export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <>
      {IS_CHAIN ? (
        <ChainProviders>{children}</ChainProviders>
      ) : (
        <OffchainProviders>{children}</OffchainProviders>
      )}
      {/* Dev tester for the dark background (🎨, bottom right). Not rendered in prod. */}
      {process.env.NODE_ENV !== "production" ? <PaletteSwitcher /> : null}
    </>
  );
}

function OffchainProviders({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            gcTime: 10 * 60_000,
            retry: 1,
            refetchOnWindowFocus: false,
            placeholderData: keepPreviousData, // navigation/param changes without skeletons flickering
          },
        },
      }),
  );
  const [provider] = useState(() => createDataProvider(process.env.NEXT_PUBLIC_DATA_SOURCE));

  return (
    <QueryClientProvider client={queryClient}>
      <DataProviderProvider value={provider}>
        <TooltipProvider delayDuration={200}>
          {children}
          <Toaster />
        </TooltipProvider>
      </DataProviderProvider>
    </QueryClientProvider>
  );
}
