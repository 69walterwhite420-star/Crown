"use client";

import { WalletAdapterNetwork, WalletReadyState, type Adapter, type WalletError } from "@solana/wallet-adapter-base";
import { CoinbaseWalletAdapter } from "@solana/wallet-adapter-coinbase";
import { LedgerWalletAdapter } from "@solana/wallet-adapter-ledger";
import { PhantomWalletAdapter } from "@solana/wallet-adapter-phantom";
import { ConnectionProvider, useWallet, WalletProvider } from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { SolflareWalletAdapter } from "@solana/wallet-adapter-solflare";
import { TrustWalletAdapter } from "@solana/wallet-adapter-trust";
import { WalletConnectWalletAdapter } from "@solana/wallet-adapter-walletconnect";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef } from "react";
import type { ChainDataProvider } from "@/lib/data/chain-provider";
import { DEVNET_RPC } from "./config";

import "@solana/wallet-adapter-react-ui/styles.css";

// WalletConnect (connects mobile/other wallets via QR) requires a projectId from cloud.reown.com.
// Without it we don't add the adapter (and don't break). No server variable needed — this is a public id.
const WC_PROJECT_ID = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID;

/**
 * The wallet-adapter tree (devnet). Explicit adapters (Phantom/Solflare/Coinbase/Trust/Ledger) — so the wallets
 * are in the modal even if not installed (with an install link). Other Standard wallets (Backpack,
 * OKX, etc.) are picked up automatically. WalletConnect — via QR for mobile, if a projectId is set.
 */
export function SolanaWalletProvider({ children }: { children: React.ReactNode }) {
  const wallets = useMemo(
    () => [
      new PhantomWalletAdapter(),
      new SolflareWalletAdapter(),
      new CoinbaseWalletAdapter(),
      new TrustWalletAdapter(),
      new LedgerWalletAdapter(),
      ...(WC_PROJECT_ID
        ? [
            new WalletConnectWalletAdapter({
              network: WalletAdapterNetwork.Devnet,
              options: {
                projectId: WC_PROJECT_ID,
                metadata: {
                  name: "Standing",
                  description: "Local reputation for crowns in USDC on Solana",
                  url: typeof window !== "undefined" ? window.location.origin : "https://standing.local",
                  icons: [],
                },
              },
            }),
          ]
        : []),
    ],
    [],
  );
  // wallet-adapter by default calls console.error on ANY wallet error — and Next.js 15 in dev renders
  // any console.error as a huge red overlay. A user decline ("User rejected the request") and
  // wallet not-ready are normal situations, not a crash: we downgrade to warn. The user-facing toast about
  // a failed crown/activation is shown by the mutations themselves (donate.tsx onError), no need to duplicate it here.
  const onError = useCallback((error: WalletError) => {
    console.warn("[wallet]", error.name, error.message);
  }, []);
  // autoConnect ONLY to an actually installed wallet. This function is consulted not only when
  // restoring the selection on reload, but also on a CLICK on a wallet in the modal. Without the gate, selecting a wallet
  // that isn't present (e.g. Trust without the extension — readyState Loadable/NotDetected) triggered connect(),
  // which on desktop goes into a deep-link and does NOT resolve: the UI hangs "connecting" with no way out, and
  // autoConnect reproduces the stall on every reload. Non-installed → we don't connect; the wallet
  // stays selected, and ChainConnect shows "Cancel sign-in".
  const onlyInstalled = useCallback(
    (adapter: Adapter) => Promise.resolve(adapter.readyState === WalletReadyState.Installed),
    [],
  );
  return (
    <ConnectionProvider endpoint={DEVNET_RPC}>
      <WalletProvider wallets={wallets} autoConnect={onlyInstalled} onError={onError}>
        <WalletModalProvider>{children}</WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}

/**
 * Injects the wallet state (useWallet) into ChainDataProvider — the class doesn't call hooks. After connecting
 * it starts the SIWS sign-in (server nonce + signature verification); on an auth change it invalidates the cache, so
 * session/myChannel are re-read under the new identity. Must live INSIDE QueryClientProvider.
 */
export function ChainWalletBridge({ provider }: { provider: ChainDataProvider }) {
  const wallet = useWallet();
  const qc = useQueryClient();
  const prevAddr = useRef<string | null>(null);
  useEffect(() => {
    provider.setWallet(wallet);
    const addr = wallet?.publicKey?.toBase58() ?? null;
    let cancelled = false;

    // The identity changed (sign in / sign out / account switch).
    if (addr !== prevAddr.current) {
      // Explicit sign-out (had an address → became null): forget the token (otherwise the token session would sign in again on
      // refresh) and INVALIDATE (NOT qc.clear!). invalidate re-reads active queries in the background, but
      // the current data stays on screen until the new data arrives → the sign-out "morphs" instantly, without skeletons.
      if (prevAddr.current !== null && addr === null) {
        provider.__logout();
        void qc.invalidateQueries();
      }
      // Sign-in/account switch (→Y) we DON'T invalidate here: the token isn't set yet (ensureAuth below), otherwise
      // a "signed out" flash would appear. ensureAuth sets the token and invalidates itself — the old data survives until
      // then without flicker.
      prevAddr.current = addr;
    }

    // Connected → verify/establish the session and re-read the data under this identity.
    if (addr) {
      provider
        .ensureAuth()
        .then((changed) => {
          if (changed && !cancelled) void qc.invalidateQueries();
        })
        .catch(() => {
          // The user declined the signature — we stay anonymous. You can still crown (no sign-in needed).
        });
    }
    return () => {
      cancelled = true;
    };
  }, [provider, wallet, qc]);
  return null;
}
