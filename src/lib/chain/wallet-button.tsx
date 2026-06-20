"use client";

import dynamic from "next/dynamic";

/**
 * Кнопка подключения реального кошелька (wallet-adapter). Грузится динамически (ssr:false), доступна
 * только внутри SolanaWalletProvider (режим chain). В bundle mock/api не попадает.
 */
export const WalletButton = dynamic(
  () => import("@solana/wallet-adapter-react-ui").then((m) => m.WalletMultiButton),
  { ssr: false, loading: () => <div className="h-8 w-40 animate-pulse rounded bg-surface-raised" /> },
);
