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
  "Spam / advertising",
  "Insults, harassment",
  "Threats, violence",
  "Prohibited (CSAM / illegal)",
  "Fraud, scam",
  "Other",
];

/** Кнопка + диалог жалобы: выбор причины и комментарий. Шлёт reportMessage(messageId, "причина: коммент"). */
export function ReportDialog({
  messageId,
  channelId,
  label = "Report",
  open: controlledOpen,
  onOpenChange,
  trigger,
  onSubmit,
  title = "Report message",
  description = "Pick a reason — the report goes to the streamer and the operator (T&S). With multiple reports the text is auto-hidden.",
}: {
  messageId?: string;
  channelId: string;
  label?: string;
  open?: boolean; // управляемый режим (напр. открыть из меню «…»)
  onOpenChange?: (open: boolean) => void;
  trigger?: ReactNode; // кастомный триггер; null → без триггера (открывают извне)
  // Задан → шлём жалобу СЮДА вместо reportMessage(messageId). Для целей, отличных от сообщения доната
  // (напр. жалоба на текст задания игры). Возвращает тот же {reports,hidden}, что reportMessage — для тоста.
  onSubmit?: (fullReason: string) => Promise<{ reports?: number; hidden?: boolean }>;
  title?: string;
  description?: string;
}) {
  const report = useReportMessage(channelId);
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : uncontrolledOpen;
  const setOpen = (o: boolean) => (isControlled ? onOpenChange?.(o) : setUncontrolledOpen(o));
  const [reason, setReason] = useState(REASONS[0] ?? "");
  const [comment, setComment] = useState("");

  const ok = (r: { reports?: number; hidden?: boolean }) => {
    toast({
      title: r.hidden ? "Hidden due to reports" : "Report sent",
      description: r.hidden
        ? "The text is auto-hidden until the streamer/operator decides."
        : typeof r.reports === "number"
          ? `Reports counted: ${r.reports}.`
          : undefined,
    });
    setOpen(false);
    setComment("");
  };
  const fail = (e: unknown) =>
    toast({
      variant: "error",
      title: "Report not sent",
      description: e instanceof Error ? e.message : String(e),
    });

  async function submit() {
    const full = comment.trim() ? `${reason}: ${comment.trim()}` : reason;
    // Кастомный таргет (напр. жалоба на текст задания игры) — вместо reportMessage(messageId).
    if (onSubmit) {
      setBusy(true);
      try {
        ok(await onSubmit(full));
      } catch (e) {
        fail(e);
      } finally {
        setBusy(false);
      }
      return;
    }
    if (!messageId) return;
    report.mutate({ messageId, reason: full }, { onSuccess: ok, onError: fail });
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
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <Select label="Reason" value={reason} onChange={(e) => setReason(e.target.value)}>
          {REASONS.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </Select>
        <Textarea
          label="Comment (optional)"
          placeholder="What exactly is wrong…"
          maxLength={280}
          showCount
          value={comment}
          onChange={(e) => setComment(e.target.value)}
        />
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost" disabled={report.isPending || busy}>
              Cancel
            </Button>
          </DialogClose>
          <Button variant="danger" loading={report.isPending || busy} onClick={submit}>
            Send report
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
