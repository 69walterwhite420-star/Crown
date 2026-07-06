"use client";

import dynamic from "next/dynamic";
import { IS_CHAIN } from "@/lib/chain/addresses";

// We load the USDC balance dynamically (ssr:false) and only in chain — wallet-adapter/spl-token don't end up
// in the mock/api bundle.
const ChainBalance = dynamic(() => import("@/lib/chain/header-balance").then((m) => m.ChainBalance), {
  ssr: false,
});

/** USDC balance chip in the header (chain mode only, when a wallet is connected). */
export function HeaderBalance() {
  if (!IS_CHAIN) return null;
  return <ChainBalance />;
}
