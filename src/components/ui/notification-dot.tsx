import { cn } from "@/lib/utils";

/**
 * Синяя точка «требует внимания» — ведёт пользователя по UI к тому, что нужно проверить (новый донат-с-текстом
 * в очереди и т.п.). Вешается на пункт навигации/триггер по пути к цели; гаснет, когда дел не осталось.
 */
export function NotificationDot({ className, title }: { className?: string; title?: string }) {
  return (
    <span
      role="status"
      aria-label={title ?? "Есть новое"}
      title={title}
      className={cn("inline-block h-2 w-2 shrink-0 rounded-full bg-info", className)}
    />
  );
}
