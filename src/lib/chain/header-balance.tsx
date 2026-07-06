"use client";

import { getAssociatedTokenAddress } from "@solana/spl-token";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { type Connection, PublicKey } from "@solana/web3.js";
import { useQuery } from "@tanstack/react-query";
import { DEVNET_USDC_MINT } from "./addresses";

/** Devnet USDC balance on the connected wallet's ATA. No token account → 0. */
async function fetchUsdc(connection: Connection, owner: PublicKey): Promise<number> {
  if (!DEVNET_USDC_MINT) return 0;
  const ata = await getAssociatedTokenAddress(new PublicKey(DEVNET_USDC_MINT), owner);
  try {
    const bal = await connection.getTokenAccountBalance(ata);
    return bal.value.uiAmount ?? 0;
  } catch {
    return 0; // ATA not created yet (never received USDC) → 0
  }
}

/** USDC balance chip in the header (devnet). Shown only when a wallet is connected. */
export function ChainBalance() {
  const { connection } = useConnection();
  const { publicKey } = useWallet();
  const { data, isLoading } = useQuery({
    queryKey: ["usdcBalance", publicKey?.toBase58()],
    queryFn: () => fetchUsdc(connection, publicKey!),
    enabled: Boolean(publicKey),
    refetchInterval: 30_000,
    staleTime: 15_000,
  });
  if (!publicKey) return null;
  return (
    <span
      className="hidden items-center gap-1 rounded border border-border bg-[var(--bg)] px-2.5 py-1.5 text-small sm:inline-flex"
      title="USDC balance (devnet)"
    >
      <span className="mono text-fg">{isLoading || data == null ? "…" : data.toFixed(2)}</span>
      <span className="text-fg-faint">USDC</span>
    </span>
  );
}
