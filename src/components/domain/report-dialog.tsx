"use client";

import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { FlagIcon } from "@/components/ui/icons";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { useReportMessage } from "@/lib/data/hooks";

// Конкретные причины — чтобы оператор/стример сразу понимали, на что жалоба.
const REASONS = [
  "Спам / реклама",
  "Оскорбления, травля",
  "Угрозы, насилие",
  "Запрещённое (CSAM / незаконное)",
  "Мошенничество, скам",
  "Другое",
];

/** Кнопка + диалог жалобы: выбор причины и комментарий. Шлёт reportMessage(messageId, "причина: коммент"). */
export function ReportDialog({
  messageId,
  channelId,
  label = "Пожаловаться",
  open: controlledOpen,
  onOpenChange,
  trigger,
}: {
  messageId: string;
  channelId: string;
  label?: string;
  open?: boolean; // управляемый режим (напр. открыть из меню «…»)
  onOpenChange?: (open: boolean) => void;
  trigger?: ReactNode; // кастомный триггер; null → без триггера (открывают извне)
}) {
  const report = useReportMessage(channelId);
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : uncontrolledOpen;
  const setOpen = (o: boolean) => (isControlled ? onOpenChange?.(o) : setUncontrolledOpen(o));
  const [reason, setReason] = useState(REASONS[0]);
  const [comment, setComment] = useState("");

  function submit() {
    const full = comment.trim() ? `${reason}: ${comment.trim()}` : reason;
    report.mutate(
      { messageId, reason: full },
      {
        onSuccess: (r) => {
          toast({
            title: r.hidden ? "Скрыто по жалобам" : "Жалоба отправлена",
            description: r.hidden
              ? "Текст авто-скрыт до решения стримера/оператора."
              : `Учтено жалоб: ${r.reports}.`,
          });
          setOpen(false);
          setComment("");
        },
        onError: (e) =>
          toast({
            variant: "error",
            title: "Жалоба не отправлена",
            description: e instanceof Error ? e.message : String(e),
          }),
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {trigger === null ? null : (
        <DialogTrigger asChild>
          {trigger ?? (
            <button
              type="button"
              title={label}
              aria-label={label}
              className="flex h-7 w-7 items-center justify-center rounded-md text-fg-faint transition-colors hover:bg-surface-raised hover:text-danger"
            >
              <FlagIcon className="h-4 w-4" />
            </button>
          )}
        </DialogTrigger>
      )}
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Пожаловаться на сообщение</DialogTitle>
          <DialogDescription>
            Выбери причину — жалоба уйдёт стримеру и оператору (T&S). При нескольких жалобах текст
            авто-скрывается.
          </DialogDescription>
        </DialogHeader>
        <Select label="Причина" value={reason} onChange={(e) => setReason(e.target.value)}>
          {REASONS.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </Select>
        <Textarea
          label="Комментарий (необязательно)"
          placeholder="Что именно не так…"
          maxLength={280}
          showCount
          value={comment}
          onChange={(e) => setComment(e.target.value)}
        />
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost" disabled={report.isPending}>
              Отмена
            </Button>
          </DialogClose>
          <Button variant="danger" loading={report.isPending} onClick={submit}>
            Отправить жалобу
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
