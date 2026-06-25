"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import { useCreateChannel, useSession } from "@/lib/data/hooks";

const HANDLE_RE = /^[a-z0-9-]{3,32}$/;

/**
 * Форма создания канала — инлайн в обзоре студии, когда канала ещё нет (отдельной страницы /studio/create
 * больше нет). После успеха myChannel инвалидируется → обзор сам перерисовывается в дашборд.
 */
export function CreateChannelForm() {
  const sessionQ = useSession();
  const create = useCreateChannel();
  const address = sessionQ.data?.address ?? null;
  const [handle, setHandle] = useState("");
  const [payout, setPayout] = useState("");

  // payoutAddress по умолчанию = логин-адрес.
  useEffect(() => {
    if (address && !payout) setPayout(address);
  }, [address, payout]);

  const handleValid = HANDLE_RE.test(handle);
  const payoutValid = payout.trim().length >= 32;
  const canSubmit = handleValid && payoutValid && !create.isPending;

  function submit() {
    create.mutate(
      { handle, payoutAddress: payout.trim() },
      {
        onSuccess: () =>
          toast({ variant: "success", title: "Канал создан", description: `@${handle} — статус BASIC.` }),
        onError: (e) =>
          toast({
            variant: "error",
            title: "Не удалось создать канал",
            description: e instanceof Error ? e.message : String(e),
          }),
      },
    );
  }

  return (
    <div className="flex max-w-lg flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h1 className="text-display-l text-fg">Создать канал</h1>
        <p className="text-fg-muted">
          Создаётся канал в статусе <span className="mono">BASIC</span> — бесплатно, но без донатов-с-текстом
          и публичной индексации (их разблокирует активация). Один канал на кошелёк.
        </p>
      </div>

      <Input
        label="Handle (публичный адрес канала)"
        placeholder="my-channel"
        value={handle}
        onChange={(e) => setHandle(e.target.value.toLowerCase())}
        helper="Латиница, цифры, дефис; 3–32 символа."
        error={handle !== "" && !handleValid ? "Недопустимый handle" : undefined}
      />
      <Input
        label="Адрес для выплат (payoutAddress)"
        mono
        value={payout}
        onChange={(e) => setPayout(e.target.value)}
        helper="По умолчанию — твой логин-адрес. Можно указать другой."
        error={payout !== "" && !payoutValid ? "Похоже на неполный адрес" : undefined}
      />

      <Button disabled={!canSubmit} loading={create.isPending} onClick={submit}>
        Создать канал
      </Button>
    </div>
  );
}
