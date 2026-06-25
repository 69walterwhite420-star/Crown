import { CheckIcon } from "@/components/ui/icons";
import { cn } from "@/lib/utils";

/**
 * Галочка «канал активирован» рядом с ником. Активация разблокирует донат-с-текстом (и будущие фичи), а сама
 * галочка — её визуальный признак. У неактивированных (BASIC) каналов галочки нет.
 */
export function VerifiedBadge({ className }: { className?: string }) {
  return (
    <span
      title="Канал активирован"
      aria-label="Канал активирован"
      className={cn(
        "inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full bg-info text-[#0a0c14]",
        className,
      )}
    >
      <CheckIcon className="h-3 w-3" />
    </span>
  );
}
