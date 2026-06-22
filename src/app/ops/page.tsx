"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ConnectWalletButton } from "@/components/layout/connect-wallet-button";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/feedback";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/toast";
import {
  useApplyOperatorAction,
  useDiscovery,
  useOperatorQueue,
  useSession,
} from "@/lib/data/hooks";
import { timeAgo } from "@/lib/utils";
import type { IncidentLog, PenaltyAction } from "@/lib/data/types";

const LADDER = [
  "Скрыть / карантин сообщения",
  "Канальный блок (стример)",
  "Временный саспенд канала (SUSPENDED)",
  "Бан роли креатора (BANNED)",
  "Полный бан кошелька",
  "Воид репутации (ADMIN_VOID)",
  "Юр-эскалация: NCMEC + preservation",
];

const ACTIONS: { value: PenaltyAction; label: string }[] = [
  { value: "HIDE_MESSAGE", label: "Скрыть сообщение" },
  { value: "CHANNEL_BLOCK", label: "Канальный блок" },
  { value: "SUSPEND_CHANNEL", label: "Саспенд канала" },
  { value: "BAN_CREATOR_ROLE", label: "Бан креатор-роли" },
  { value: "BAN_WALLET_FULL", label: "Полный бан кошелька" },
  { value: "ADMIN_VOID", label: "Воид репутации (ADMIN_VOID)" },
];

// Какие цели нужны действию: канал и/или адрес кошелька. Под выбранное действие показываем нужные поля.
const REQUIRES: Record<PenaltyAction, { channel: boolean; address: boolean }> = {
  HIDE_MESSAGE: { channel: true, address: false },
  CHANNEL_BLOCK: { channel: true, address: true },
  SUSPEND_CHANNEL: { channel: true, address: false },
  BAN_CREATOR_ROLE: { channel: true, address: false },
  BAN_WALLET_FULL: { channel: false, address: true },
  ADMIN_VOID: { channel: true, address: true },
};

export default function OpsConsolePage() {
  const sessionQ = useSession();
  const queueQ = useOperatorQueue();
  const discoveryQ = useDiscovery();
  const apply = useApplyOperatorAction();

  const [action, setAction] = useState<PenaltyAction>("SUSPEND_CHANNEL");
  const [channelId, setChannelId] = useState("");
  const [address, setAddress] = useState("");
  const [reason, setReason] = useState("");
  const [preservation, setPreservation] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const req = REQUIRES[action];
  const canApply =
    (!req.channel || channelId.trim() !== "") && (!req.address || address.trim() !== "");

  function doApply() {
    apply.mutate(
      {
        action,
        targetChannelId: channelId.trim() || undefined,
        targetAddress: address.trim() || undefined,
        reason: reason.trim() || action,
        preservation: preservation || undefined,
        reported: preservation || undefined,
      },
      {
        onSuccess: () => {
          toast({ variant: "success", title: "Действие применено", description: action });
          setConfirmOpen(false);
        },
        onError: (e) => toast({ variant: "error", title: "Ошибка", description: String(e) }),
      },
    );
  }

  // Гейт доступа: консоль T&S видна ТОЛЬКО оператору. Прочие действия и так блокирует сервер (requireOperator),
  // но и саму консоль не показываем. (Источник истины — getSession.isOperator по проверенному адресу.)
  if (sessionQ.isLoading) return <Skeleton className="h-64 w-full rounded-lg" />;
  if (!sessionQ.data?.isOperator) {
    return (
      <EmptyState
        title="Доступ только для оператора"
        description="Консоль T&S доступна лишь кошельку-оператору платформы. Войди кошельком оператора."
        action={<ConnectWalletButton />}
      />
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-1">
        <h1 className="text-display-l text-fg">Консоль оператора / T&amp;S</h1>
        <p className="text-fg-muted">
          Платформенный уровень: то, что не может стример. ADMIN_VOID — единственное списание репутации.
        </p>
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="text-h2 text-fg">Лестница наказаний</h2>
        <ol className="flex flex-col gap-1">
          {LADDER.map((step, i) => (
            <li key={step} className="flex items-center gap-3 rounded border border-border bg-surface px-3 py-2">
              <span className="mono text-small text-fg-faint">{i + 1}</span>
              <span className="text-small text-fg">{step}</span>
            </li>
          ))}
        </ol>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-h2 text-fg">Применить действие</h2>
        <div className="grid gap-3 rounded-lg border border-border bg-surface p-4 sm:grid-cols-2">
          <Select label="Действие" value={action} onChange={(e) => setAction(e.target.value as PenaltyAction)}>
            {ACTIONS.map((a) => (
              <option key={a.value} value={a.value}>
                {a.label}
              </option>
            ))}
          </Select>
          <Input label="Причина" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="CSAM / flood / sanctions" />
          {req.channel ? (
            <Select label="Канал" value={channelId} onChange={(e) => setChannelId(e.target.value)}>
              <option value="">— выбери канал —</option>
              {(discoveryQ.data?.items ?? []).map((c) => (
                <option key={c.channelId} value={c.channelId}>
                  @{c.handle}
                </option>
              ))}
            </Select>
          ) : null}
          {req.address ? (
            <Input
              label="Адрес кошелька"
              mono
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="вставь base58-адрес"
            />
          ) : null}
          <Switch checked={preservation} onCheckedChange={setPreservation} label="Preservation + репорт (NCMEC)" />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="danger" disabled={!canApply} onClick={() => setConfirmOpen(true)}>
            Применить действие
          </Button>
          {!canApply ? (
            <span className="text-small text-fg-faint">
              Укажи цель: {[req.channel && "канал", req.address && "адрес кошелька"].filter(Boolean).join(" + ")}
            </span>
          ) : null}
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-h2 text-fg">Инцидент-лог</h2>
        {queueQ.isLoading ? (
          <Skeleton className="h-32 w-full" />
        ) : queueQ.error ? (
          <ErrorState onRetry={() => queueQ.refetch()} />
        ) : (queueQ.data ?? []).length === 0 ? (
          <EmptyState title="Инцидентов нет" />
        ) : (
          <ul className="flex flex-col gap-2">
            {queueQ.data!.map((inc: IncidentLog) => (
              <li key={inc.id} className="flex flex-col gap-1 rounded border border-border bg-surface px-3 py-2">
                <div className="flex items-center justify-between">
                  <span className="mono text-small text-status">{inc.kind}</span>
                  <span className="text-small text-fg-faint">{timeAgo(inc.ts)}</span>
                </div>
                <span className="text-small text-fg">{inc.detail}</span>
                {inc.resolution ? (
                  <span className="text-small text-fg-faint">→ {inc.resolution}</span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Подтверждение действия</DialogTitle>
            <DialogDescription>
              {ACTIONS.find((a) => a.value === action)?.label}. Деструктивные действия записываются в
              инцидент-лог.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="ghost" disabled={apply.isPending}>
                Отмена
              </Button>
            </DialogClose>
            <Button variant="danger" loading={apply.isPending} onClick={doApply}>
              Применить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
