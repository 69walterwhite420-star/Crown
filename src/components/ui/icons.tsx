/**
 * Минималистичные stroke-иконки (24×24, currentColor, без заливки). Размер задаётся через className (h-/w-).
 * Без иконочной библиотеки — чтобы не тащить зависимость ради пары глифов.
 */
type IconProps = { className?: string };

const stroke = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

/** Лупа — для поисковых полей. */
export function SearchIcon({ className }: IconProps) {
  return (
    <svg {...stroke} className={className}>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.6-3.6" />
    </svg>
  );
}

/** Крестик — очистить/закрыть. */
export function XIcon({ className }: IconProps) {
  return (
    <svg {...stroke} className={className}>
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}

/** Шеврон вправо — пагинация/«вперёд». */
export function ChevronRightIcon({ className }: IconProps) {
  return (
    <svg {...stroke} className={className}>
      <path d="m9 6 6 6-6 6" />
    </svg>
  );
}

/** Шеврон влево — пагинация/«назад». */
export function ChevronLeftIcon({ className }: IconProps) {
  return (
    <svg {...stroke} className={className}>
      <path d="m15 6-6 6 6 6" />
    </svg>
  );
}

/** Шеврон вниз — раскрытие селекта. */
export function ChevronDownIcon({ className }: IconProps) {
  return (
    <svg {...stroke} className={className}>
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

/** Щит — действия модерации (скрыть/бан). */
export function ShieldIcon({ className }: IconProps) {
  return (
    <svg {...stroke} className={className}>
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  );
}

/** Внешняя ссылка (открыть в новой вкладке) — напр. транзакция в проводнике. */
export function ExternalLinkIcon({ className }: IconProps) {
  return (
    <svg {...stroke} className={className}>
      <path d="M15 3h6v6" />
      <path d="M10 14 21 3" />
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    </svg>
  );
}

/** Флажок — жалоба/репорт. */
export function FlagIcon({ className }: IconProps) {
  return (
    <svg {...stroke} className={className}>
      <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" />
      <path d="M4 22v-7" />
    </svg>
  );
}

/** Копирование (две накладки) — скопировать адрес/хэш. */
export function CopyIcon({ className }: IconProps) {
  return (
    <svg {...stroke} className={className}>
      <rect x="9" y="9" width="13" height="13" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

/** Галочка — успех/скопировано. */
export function CheckIcon({ className }: IconProps) {
  return (
    <svg {...stroke} className={className}>
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

/** Карандаш — редактировать. */
export function PencilIcon({ className }: IconProps) {
  return (
    <svg {...stroke} className={className}>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}

/** Глаз — показать. */
export function EyeIcon({ className }: IconProps) {
  return (
    <svg {...stroke} className={className}>
      <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

/** Зачёркнутый глаз — скрыть. */
export function EyeOffIcon({ className }: IconProps) {
  return (
    <svg {...stroke} className={className}>
      <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
      <path d="M10.73 5.08A10.4 10.4 0 0 1 12 5c7 0 10 7 10 7a13.2 13.2 0 0 1-1.67 2.68" />
      <path d="M6.61 6.61A13.5 13.5 0 0 0 2 12s3 7 10 7a9.7 9.7 0 0 0 5.39-1.61" />
      <path d="m2 2 20 20" />
    </svg>
  );
}

/** Замок — «непередаваемо». */
export function LockIcon({ className }: IconProps) {
  return (
    <svg {...stroke} className={className}>
      <rect x="3" y="11" width="18" height="11" rx="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}

/** Корона — высший тир. */
export function CrownIcon({ className }: IconProps) {
  return (
    <svg {...stroke} className={className}>
      <path d="M3 7 7 11 12 5 17 11 21 7 19.5 19 4.5 19Z" />
    </svg>
  );
}

/** Три точки — меню «ещё». */
export function MoreIcon({ className }: IconProps) {
  return (
    <svg {...stroke} className={className}>
      <circle cx="5" cy="12" r="1.4" fill="currentColor" />
      <circle cx="12" cy="12" r="1.4" fill="currentColor" />
      <circle cx="19" cy="12" r="1.4" fill="currentColor" />
    </svg>
  );
}
