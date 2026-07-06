"use client";

import { ConnectWalletButton } from "./connect-wallet-button";
import { useSession } from "@/lib/data/hooks";
import { shortAddress } from "@/lib/utils";

const IS_CHAIN = process.env.NEXT_PUBLIC_DATA_SOURCE === "chain";

/** Header: auth-aware wallet/sign-in button (chain) or session address (dev mock/api). */
export function WalletConnectButton() {
  const { data: session, isLoading } = useSession();

  // Chain mode — auth-aware button: connects the wallet, and if there's no session — offers "Sign in (signature)".
  if (IS_CHAIN) return <ConnectWalletButton />;

  // api/mock — dev: sign-in by address goes through DevToolbar; in the header we just show the session address, if any.
  if (isLoading) return <div className="h-9 w-32 animate-pulse rounded bg-surface-raised" />;
  return session?.address ? (
    <span className="mono text-small text-fg-muted">{shortAddress(session.address)}</span>
  ) : null;
}
