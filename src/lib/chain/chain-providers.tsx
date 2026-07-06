"use client";

import { keepPreviousData, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { Toaster } from "@/components/ui/toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ChainDataProvider } from "@/lib/data/chain-provider";
import { IcpDataProvider } from "@/lib/data/icp-provider";
import { DataProviderProvider } from "@/lib/data/context";
import { IS_ICP } from "./addresses";
import { ChainWalletBridge, SolanaWalletProvider } from "./wallet-provider";

/**
 * Providers for the `chain`/`icp` modes (Phase 3 / migration M1). Loaded as a dynamic chunk,
 * so the heavy Solana stack doesn't end up in the mock/api bundle. `icp` = the same chain provider,
 * but the canonical source for reading Reign is the ICP core canister (IcpDataProvider, ADR 0021).
 */
export function ChainProviders({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000, // data stays "fresh" for 30s → returning to a page is instant from cache, no refetch
            gcTime: 10 * 60_000, // keep the cache for 10 min → navigating back and forth without a reload
            retry: 1,
            refetchOnWindowFocus: false,
            // on a key change (navigation/param change) we show the previous data while the new data loads —
            // without skeleton flicker. The new data replaces the old when it arrives.
            placeholderData: keepPreviousData,
          },
        },
      }),
  );
  const [provider] = useState(() => (IS_ICP ? new IcpDataProvider() : new ChainDataProvider()));

  return (
    <SolanaWalletProvider>
      <QueryClientProvider client={queryClient}>
        <ChainWalletBridge provider={provider} />
        <DataProviderProvider value={provider}>
          <TooltipProvider delayDuration={200}>
            {children}
            <Toaster />
          </TooltipProvider>
        </DataProviderProvider>
      </QueryClientProvider>
    </SolanaWalletProvider>
  );
}
