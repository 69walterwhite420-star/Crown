"use client";

import { WalletReadyState } from "@solana/wallet-adapter-base";
import { useWallet } from "@solana/wallet-adapter-react";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { LabeledWalletButton } from "./wallet-multi-button";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { useData } from "@/lib/data/context";
import { useSession } from "@/lib/data/hooks";

/**
 * Кнопка подключения/входа, учитывающая ТРИ состояния (они разные!): кошелёк выбран-но-не-подключён
 * (лимбо), подключён ли кошелёк (wallet-adapter) и есть ли серверная сессия (SIWS).
 *
 * Лимбо: выбран кошелёк, которого нет (напр. Trust без расширения). autoConnect к нему заблокирован
 * (см. wallet-provider), а штатная кнопка в состоянии «выбран» повторно зовёт connect() → снова виснет.
 * Поэтому здесь рулим сами и ВСЕГДА даём выход «Отменить вход» (disconnect + забыть выбор).
 *
 * Подключён без сессии (автоподпись из bridge не прошла — кошелёк отклонил/не поддержал signMessage):
 * показываем «Войти (подпись)» — повторный SIWS с ошибкой, если подпись не удалась.
 */
export function ChainConnect() {
  const wallet = useWallet();
  const session = useSession();
  const data = useData();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);

  // Лимбо: кошелёк выбран, но не подключён. После выхода/штатного disconnect выбор уже очищен самим
  // адаптером (setWalletName(null)), так что сюда попадает только «выбран, но так и не подключился».
  const selected = wallet.wallet;
  const installed = selected?.readyState === WalletReadyState.Installed;
  const limbo = !!selected && !wallet.connected;
  const [showBail, setShowBail] = useState(false);
  // Установленный кошелёк может штатно подключаться пару секунд — спиннер. Если завис дольше, дадим выход.
  useEffect(() => {
    if (!limbo || !installed) {
      setShowBail(false);
      return;
    }
    const t = setTimeout(() => setShowBail(true), 6000);
    return () => clearTimeout(t);
  }, [limbo, installed]);

  // Сбросить «прилипший» выбор → вернуться к кнопке «Войти».
  async function bail() {
    try {
      await wallet.disconnect();
    } catch {
      // мог быть и не подключён — это и есть причина выхода
    }
    wallet.select(null); // забыть выбор (чистит walletName в localStorage)
  }

  if (selected && !wallet.connected) {
    // Выбран кошелёк, которого НЕТ (напр. Trust без расширения): подключение к нему не пойдёт (autoConnect
    // гейтит не-installed, см. wallet-provider). Не молчим — ведём ставить его на сайте кошелька + даём отмену.
    if (!installed) {
      return (
        <div className="flex items-center gap-2">
          <Button size="sm" asChild>
            <a href={selected.adapter.url} target="_blank" rel="noreferrer">
              Установить {selected.adapter.name}
            </a>
          </Button>
          <Button size="sm" variant="ghost" onClick={bail}>
            Отмена
          </Button>
        </div>
      );
    }
    // Установленный — подключается; если подвис дольше grace, показываем выход.
    return showBail ? (
      <Button size="sm" variant="secondary" onClick={bail}>
        Отменить вход
      </Button>
    ) : (
      <Button size="sm" loading disabled>
        Вход…
      </Button>
    );
  }

  const connectedNoSession = wallet.connected && !session.data?.address;
  if (connectedNoSession) {
    return (
      <Button
        size="sm"
        loading={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await data.connect(); // chain: ensureAuth → подпись SIWS текущим кошельком
            await qc.invalidateQueries(); // обновить сессию и все гейты
          } catch (e) {
            toast({
              variant: "error",
              title: "Не удалось войти",
              description: e instanceof Error ? e.message : String(e),
            });
          } finally {
            setBusy(false);
          }
        }}
      >
        Войти (подпись)
      </Button>
    );
  }
  // кошелёк не подключён → обычная кнопка кошелька (подключит + bridge автоподпишет)
  return <LabeledWalletButton />;
}
