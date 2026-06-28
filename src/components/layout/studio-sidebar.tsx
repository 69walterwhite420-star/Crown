"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NotificationDot } from "@/components/ui/notification-dot";
import { useModerationAttention, useMyChannel } from "@/lib/data/hooks";
import { cn } from "@/lib/utils";

const MANAGE_ITEMS = [
  { href: "/studio", label: "Обзор" },
  { href: "/studio/queue", label: "Очередь модерации" },
  { href: "/studio/settings", label: "Настройки канала" },
  { href: "/studio/blocklist", label: "Блок-лист" },
];

/**
 * Сайдбар студии (десктоп — фиксирован, rail-pinned-left). Без канала показываем только «Обзор» (там форма
 * создания). Создание/активация — НЕ отдельные пункты: создание инлайн в обзоре, активация — контекстным
 * баннером во всех вкладках (ChannelStatusBanner), чтобы пункты не висели после выполнения шага.
 */
export function StudioSidebar() {
  const pathname = usePathname();
  const { data: channel } = useMyChannel();
  const { hasPending } = useModerationAttention();
  const items = channel ? MANAGE_ITEMS : [{ href: "/studio", label: "Обзор" }];
  return (
    <aside className="w-full shrink-0 rail-pinned-left">
      <div className="mb-4 font-display text-h3 text-fg">Студия</div>
      <nav className="flex flex-col gap-1 text-small">
        {items.map((it) => {
          const active = pathname === it.href;
          const attention = it.href === "/studio/queue" && hasPending; // новые донаты-с-текстом ждут решения
          return (
            <Link
              key={it.href}
              href={it.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex items-center justify-between gap-2 rounded px-3 py-2 transition-colors duration-fast ease-ease",
                active ? "bg-surface-raised text-fg" : "text-fg-muted hover:bg-surface-raised hover:text-fg",
              )}
            >
              {it.label}
              {attention ? <NotificationDot title="Есть что проверить в очереди" /> : null}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
