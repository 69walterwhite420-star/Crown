"use client";

import { useState } from "react";
import { Amount } from "./amount";
import { Button } from "@/components/ui/button";
import { XIcon } from "@/components/ui/icons";
import { toast } from "@/components/ui/toast";
import { ACTIVATION_FEE_MICRO } from "@/lib/chain/addresses";
import { useActivateChannel, useMyChannel } from "@/lib/data/hooks";

/**
 * Контекстное напоминание о статусе канала в студии (показывается во ВСЕХ вкладках через layout, а не
 * отдельной страницей). BASIC → активация прямо тут (инлайн-кнопка, без перехода). SUSPENDED/BANNED → инфо.
 * ACTIVE или нет канала → ничего. Самодостаточен: сам берёт канал из useMyChannel.
 */
export function ChannelStatusBanner() {
  const { data: channel } = useMyChannel();
  const activate = useActivateChannel();
  // Локальный скрыт-стейт: крестик прячет напоминание только в текущем сеансе. На reload / повторном заходе
  // в студию компонент перемонтируется → dismissed сбрасывается → баннер снова появляется (не персистим).
  const [dismissed, setDismissed] = useState(false);

  if (!channel || channel.status === "ACTIVE") return null;

  if (channel.status === "BASIC") {
    if (dismissed) return null;
    return (
      <div className="mb-6 flex flex-col gap-3 rounded-lg border border-status bg-status-bg p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-1">
          <span className="text-h3 text-fg">Realm @{channel.handle} is not activated</span>
          <span className="text-small text-fg-muted">
            Activate to unlock crowns-with-text and public indexing. One-time
            fee <Amount micro={ACTIVATION_FEE_MICRO} />.
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            variant="money"
            loading={activate.isPending}
            onClick={() =>
              activate.mutate(channel.id, {
                onSuccess: () => toast({ variant: "success", title: "Realm activated" }),
                onError: (e) =>
                  toast({ variant: "error", title: "Activation failed", description: String(e) }),
              })
            }
          >
            Activate
          </Button>
          <button
            type="button"
            aria-label="Dismiss reminder"
            onClick={() => setDismissed(true)}
            className="flex h-9 w-9 items-center justify-center rounded-md text-fg-muted transition-colors hover:bg-surface-raised hover:text-fg"
          >
            <XIcon className="h-4 w-4" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mb-6 rounded-lg border border-danger bg-danger-bg p-4">
      <span className="text-h3 text-fg">
        {channel.status === "SUSPENDED" ? "Realm suspended" : "Realm banned"}
      </span>
      <p className="text-small text-fg-muted">
        {channel.status === "SUSPENDED"
          ? "The realm is under operator review. Wait for a decision or contact support."
          : "The realm was banned by the platform. The only way back is a new wallet and re-activation."}
      </p>
    </div>
  );
}
