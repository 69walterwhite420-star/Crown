"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import { useCreateChannel, useSession } from "@/lib/data/hooks";
import { isLikelyBase58Address } from "@/lib/utils";

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
  const payoutValid = isLikelyBase58Address(payout.trim());
  const canSubmit = handleValid && payoutValid && !create.isPending;

  function submit() {
    create.mutate(
      { handle, payoutAddress: payout.trim() },
      {
        onSuccess: () =>
          toast({ variant: "success", title: "Realm created", description: `@${handle} — status BASIC.` }),
        onError: (e) =>
          toast({
            variant: "error",
            title: "Couldn't create realm",
            description: e instanceof Error ? e.message : String(e),
          }),
      },
    );
  }

  return (
    <div className="flex max-w-lg flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h1 className="text-display-l text-fg">Create realm</h1>
        <p className="text-fg-muted">
          A realm is created with <span className="mono">BASIC</span> status — free, but without
          crowns-with-text and public indexing (activation unlocks those). One realm per wallet.
        </p>
      </div>

      <Input
        label="Handle (public realm address)"
        placeholder="my-channel"
        value={handle}
        onChange={(e) => setHandle(e.target.value.toLowerCase())}
        helper="Latin letters, digits, hyphen; 3–32 characters."
        error={handle !== "" && !handleValid ? "Invalid handle" : undefined}
      />
      <Input
        label="Payout address (payoutAddress)"
        mono
        value={payout}
        onChange={(e) => setPayout(e.target.value)}
        helper="Defaults to your login address. You can set a different one."
        error={payout !== "" && !payoutValid ? "Looks like an incomplete address" : undefined}
      />

      <Button disabled={!canSubmit} loading={create.isPending} onClick={submit}>
        Create realm
      </Button>
    </div>
  );
}
