"use client";

import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { useAddBlock, useChannelBlocklist } from "@/lib/data/hooks";
import { shortAddress } from "@/lib/utils";

/**
 * Кнопка «Забанить» для владельца/модератора канала: ОДИН клик → addChannelBlock → кошелёк попадает в
 * блок-лист канала (донаты-с-текстом ему запрещены). Обратимо со страницы блок-листа. Если адрес уже в
 * бане — вместо кнопки показываем статус. Рендерить только в управляющих местах (студия/очередь/свой канал):
 * сам addChannelBlock авторизуется на сервере (владелец/модератор), здесь — только удобный доступ.
 */
export function BlockButton({ channelId, address }: { channelId: string; address: string }) {
  const block = useAddBlock(channelId);
  const blocklist = useChannelBlocklist(channelId);
  const blocked = (blocklist.data ?? []).some((b) => b.blockedAddress === address);

  if (blocked) return <span className="text-small text-danger">в бане</span>;
  return (
    <Button
      variant="ghost"
      size="sm"
      loading={block.isPending}
      className="text-danger hover:bg-danger-bg hover:text-danger"
      onClick={() =>
        block.mutate(
          { address },
          {
            onSuccess: () =>
              toast({
                variant: "success",
                title: "Забанен на канале",
                description: shortAddress(address),
              }),
            onError: (e) =>
              toast({ variant: "error", title: "Не удалось забанить", description: String(e) }),
          },
        )
      }
    >
      Забанить
    </Button>
  );
}
