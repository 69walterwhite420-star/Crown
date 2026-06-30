"use client";

import dynamic from "next/dynamic";
import { IS_CHAIN } from "@/lib/chain/addresses";

// Баланс USDC грузим динамически (ssr:false) и только в chain — wallet-adapter/spl-token не попадают
// в bundle mock/api.
const ChainBalance = dynamic(() => import("@/lib/chain/header-balance").then((m) => m.ChainBalance), {
  ssr: false,
});

/** Чип баланса USDC в шапке (только chain-режим, при подключённом кошельке). */
export function HeaderBalance() {
  if (!IS_CHAIN) return null;
  return <ChainBalance />;
}
