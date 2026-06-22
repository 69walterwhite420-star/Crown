import { notFound } from "next/navigation";

import { IS_PROD } from "@/lib/chain/addresses"; // единый источник prod-гейта (NODE_ENV === "production")

/**
 * Гейт dev-поверхности (`/dev/*`, напр. kitchen-sink): в production маршрут не существует (404), а не
 * «достижим, но инертен». Серверный layout — env-проверка идёт на сервере, страница в бандл не попадает.
 * Закрывает открытый пункт из docs/audit-map.md §3 (dev-поверхность и её гейтинг).
 */
export default function DevLayout({ children }: { children: React.ReactNode }) {
  if (IS_PROD) notFound();
  return <>{children}</>;
}
