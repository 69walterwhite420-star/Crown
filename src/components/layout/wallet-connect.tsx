"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { WalletButton } from "@/lib/chain/wallet-button";
import { useSession } from "@/lib/data/hooks";
import { shortAddress } from "@/lib/utils";

const IS_CHAIN = process.env.NEXT_PUBLIC_DATA_SOURCE === "chain";

/** Шапка: реальный кошелёк (chain) или dev-вход по адресу (api/mock, через /connect). */
export function WalletConnectButton() {
  const { data: session, isLoading } = useSession();

  // Режим chain — настоящая кнопка wallet-adapter (Phantom/Solflare на devnet).
  if (IS_CHAIN) return <WalletButton />;

  // api/mock — dev: подключение по адресу на экране /connect.
  if (isLoading) return <div className="h-8 w-32 animate-pulse rounded bg-surface-raised" />;
  return (
    <Button asChild size="sm" variant="secondary">
      <Link href="/connect">
        {session?.address ? shortAddress(session.address) : "Подключить (dev)"}
      </Link>
    </Button>
  );
}
