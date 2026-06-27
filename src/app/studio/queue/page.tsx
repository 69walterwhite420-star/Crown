"use client";

import { useState } from "react";
import { ModerationItem } from "@/components/domain/moderation";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/feedback";
import { Pager, usePager } from "@/components/ui/pager";
import { Select } from "@/components/ui/select";
import { toast } from "@/components/ui/toast";
import {
  useDonations,
  useManagedChannels,
  useModerationQueue,
  useSetMessageState,
} from "@/lib/data/hooks";

export default function ModerationQueuePage() {
  // Каналы, которыми управляешь: владелец ИЛИ модератор (раньше очередь брала только канал-владельца через
  // getMyChannel, поэтому модератор её не видел).
  const managedQ = useManagedChannels();
  const channels = managedQ.data ?? [];
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const channelId = selectedId ?? channels[0]?.id;

  const queueQ = useModerationQueue(channelId);
  const donationsQ = useDonations(channelId);
  const setState = useSetMessageState(channelId ?? "");

  // Джойн message → donation, чтобы показать донора и сумму в очереди.
  const byDonation = new Map((donationsQ.data?.items ?? []).map((d) => [d.id, d]));
  const pg = usePager(queueQ.data ?? [], 10); // постранично, чтобы очередь не уходила в бесконечность

  if (managedQ.isLoading) return <Skeleton className="h-56 w-full rounded-lg" />;
  if (channels.length === 0) {
    return (
      <EmptyState
        title="Нет каналов на модерации"
        description="Создай свой канал или попроси владельца добавить твой кошелёк в модераторы."
      />
    );
  }

  const heldCount = (queueQ.data ?? []).length;
  const currentChannel = channels.find((c) => c.id === channelId);

  function act(messageId: string, state: "SHOWN" | "HIDDEN") {
    setState.mutate(
      { messageId, state },
      {
        onSuccess: () => toast({ title: state === "SHOWN" ? "Показано" : "Скрыто" }),
        onError: (e) => toast({ variant: "error", title: "Ошибка", description: String(e) }),
      },
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-2">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-display-l text-fg">Очередь модерации</h1>
            {heldCount > 0 ? (
              <span className="inline-flex items-center gap-1.5 rounded-pill bg-money-bg px-2.5 py-0.5 text-small text-money">
                <span className="h-1.5 w-1.5 rounded-pill bg-money" />
                {heldCount} на модерации
              </span>
            ) : null}
          </div>
          <p className="text-fg-muted">
            Текст приватен до показа. Деньги и standing донора уже зачтены — решаешь только судьбу текста.
          </p>
        </div>
        {channels.length > 1 ? (
          <Select
            value={channelId}
            onChange={(e) => setSelectedId(e.target.value)}
            aria-label="Канал"
            className="sm:w-56"
          >
            {channels.map((c) => (
              <option key={c.id} value={c.id}>
                @{c.handle}
              </option>
            ))}
          </Select>
        ) : currentChannel ? (
          <span className="mono shrink-0 text-small text-fg-faint">@{currentChannel.handle}</span>
        ) : null}
      </div>

      {queueQ.isLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : queueQ.error ? (
        <ErrorState description="Не удалось загрузить очередь." onRetry={() => queueQ.refetch()} />
      ) : (queueQ.data ?? []).length === 0 ? (
        <EmptyState title="Очередь чиста" description="Новые сообщения на модерации появятся здесь." />
      ) : (
        <div className="flex flex-col">
          <div className="flex flex-col [&>:last-child]:border-b-0">
            {pg.pageItems.map((m) => {
              const d = byDonation.get(m.donationId);
              return (
                <ModerationItem
                  key={m.id}
                  message={m}
                  donor={d?.donor}
                  donorName={d?.donorName}
                  amount={d?.amount}
                  pending={setState.isPending && setState.variables?.messageId === m.id}
                  onShow={() => act(m.id, "SHOWN")}
                  onHide={() => act(m.id, "HIDDEN")}
                />
              );
            })}
          </div>
          <div className="pt-4">
            <Pager
              page={pg.page}
              pageCount={pg.pageCount}
              total={pg.total}
              pageSize={pg.pageSize}
              setPage={pg.setPage}
              setPageSize={pg.setPageSize}
            />
          </div>
        </div>
      )}
    </div>
  );
}
