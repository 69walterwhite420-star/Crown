"use client";

import dynamic from "next/dynamic";
import { IS_CHAIN } from "@/lib/chain/addresses";

// Auth-aware sign-in button (accounts for both the wallet connection and an active SIWS session). Loaded
// dynamically (ssr:false), only in chain mode → the wallet-adapter stack stays out of the mock/api bundle.
const ChainConnect = dynamic(() => import("@/lib/chain/chain-connect").then((m) => m.ChainConnect), {
  ssr: false,
  loading: () => <div className="h-9 w-40 animate-pulse rounded bg-surface-raised" />,
});

/**
 * The single "Sign in" button. In chain — connects the wallet and, if needed, kicks off the SIWS signature
 * (see ChainConnect). Replaces the old links to the removed /connect page. In dev (mock/api) sign-in goes
 * through DevToolbar, so this is null.
 */
export function ConnectWalletButton() {
  if (!IS_CHAIN) return null;
  return <ChainConnect />;
}
