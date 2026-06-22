"use client";

import { toast } from "@/components/ui/toast";
import { useReportMessage } from "@/lib/data/hooks";

/** Кнопка «Пожаловаться» на показанный текст. Любой вошедший зритель; сервер режет повторы и не-сессии. */
export function ReportButton({ messageId, channelId }: { messageId: string; channelId: string }) {
  const report = useReportMessage(channelId);
  return (
    <button
      type="button"
      disabled={report.isPending}
      className="text-small text-fg-faint transition-colors hover:text-danger disabled:opacity-50"
      onClick={() =>
        report.mutate(
          { messageId },
          {
            onSuccess: (r) =>
              toast({
                title: r.hidden ? "Скрыто по жалобам" : "Жалоба отправлена",
                description: r.hidden
                  ? "Текст авто-скрыт до решения стримера/оператора."
                  : `Учтено жалоб: ${r.reports}.`,
              }),
            onError: (e) =>
              toast({
                variant: "error",
                title: "Жалоба не отправлена",
                description: e instanceof Error ? e.message : String(e),
              }),
          },
        )
      }
    >
      Пожаловаться
    </button>
  );
}
