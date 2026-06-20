"use client";

import Link from "next/link";
import { useState } from "react";
import { AppHeader } from "@/components/layout/app-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { WalletButton } from "@/lib/chain/wallet-button";
import { useDevControls, useSession } from "@/lib/data/hooks";
import { shortAddress } from "@/lib/utils";

const IS_CHAIN = process.env.NEXT_PUBLIC_DATA_SOURCE === "chain";

export default function ConnectPage() {
  const sessionQ = useSession();
  const dev = useDevControls();
  const [addr, setAddr] = useState("");
  const address = sessionQ.data?.address ?? null;

  return (
    <>
      <AppHeader />
      <main className="mx-auto flex max-w-lg flex-col gap-5 px-4 py-8">
        <div className="flex flex-col gap-1">
          <h1 className="text-display-l text-fg">Подключение кошелька</h1>
          <p className="text-fg-muted">
            {IS_CHAIN
              ? "Подключи кошелёк Solana (Phantom/Solflare) на devnet. Кошелёк = аккаунт."
              : "Dev-режим (mock/api): войди по произвольному devnet-адресу для теста без кошелька."}
          </p>
        </div>

        {IS_CHAIN ? (
          <div className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4">
            <WalletButton />
            <div className="flex flex-col gap-1 text-small text-fg-muted">
              <span>Чтобы донатить на devnet, кошелёк должен иметь:</span>
              <span>
                • SOL на газ —{" "}
                <a className="text-info hover:underline" href="https://faucet.solana.com" target="_blank" rel="noreferrer">
                  faucet.solana.com
                </a>
              </span>
              <span>
                • USDC (devnet) —{" "}
                <a className="text-info hover:underline" href="https://faucet.circle.com" target="_blank" rel="noreferrer">
                  faucet.circle.com
                </a>{" "}
                (выбери Solana Devnet)
              </span>
            </div>
          </div>
        ) : address ? (
          <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
            <span className="text-small text-fg-muted">Подключён (dev)</span>
            <span className="mono text-h3 text-fg">{shortAddress(address)}</span>
            <div className="flex gap-2">
              <Button asChild size="sm">
                <Link href="/">На платформу</Link>
              </Button>
              <Button variant="ghost" size="sm" onClick={() => dev.setAddress(null)}>
                Выйти
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
            <Input
              mono
              label="Devnet-адрес для входа (dev)"
              placeholder="вставь base58-адрес"
              value={addr}
              onChange={(e) => setAddr(e.target.value)}
            />
            <Button disabled={addr.trim().length < 32} onClick={() => dev.setAddress(addr.trim())}>
              Войти как адрес
            </Button>
          </div>
        )}
      </main>
    </>
  );
}
