"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

/**
 * Кроссфейд между страницами через нативный View Transitions API. Перехватываем клик по ВНУТРЕННЕЙ ссылке
 * в capture-фазе и оборачиваем навигацию в `document.startViewTransition` → браузер сам делает кросс-фейд
 * снимков (старая страница гаснет, новая проявляется). Промис VT резолвим, когда навигация фактически
 * применилась (сменился pathname).
 *
 * Безопасность: если API не поддержан — НИЧЕГО не перехватываем (обычная навигация Next). Перехватываем
 * только «чистые» левые клики по внутренним ссылкам (без модификаторов, target, download, чужого origin,
 * без hash-only). На всё остальное не влияем. Компонент монтируется один раз в layout; легко снять.
 */
export function PageTransitions() {
  const router = useRouter();
  const pathname = usePathname();
  const finish = useRef<(() => void) | null>(null);

  // Навигация применилась → закрываем отложенный VT (браузер снимет новый кадр и доиграет кроссфейд).
  useEffect(() => {
    if (finish.current) {
      finish.current();
      finish.current = null;
    }
  }, [pathname]);

  useEffect(() => {
    const doc = document as Document & {
      startViewTransition?: (cb: () => void | Promise<void>) => unknown;
    };
    if (typeof doc.startViewTransition !== "function") return; // нет поддержки → обычная навигация

    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey)
        return;
      const target = e.target as Element | null;
      const a = target?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a) return;
      if (a.target && a.target !== "_self") return;
      if (a.hasAttribute("download")) return;
      if ((a.getAttribute("rel") || "").includes("external")) return;

      let url: URL;
      try {
        url = new URL(a.href, location.href);
      } catch {
        return;
      }
      if (url.origin !== location.origin) return; // внешняя ссылка — не трогаем
      // Та же страница (только хэш/якорь) — не перехватываем, пусть работает штатно.
      if (url.pathname === location.pathname && url.search === location.search) return;

      e.preventDefault();
      e.stopPropagation(); // не даём Link'у навигировать повторно (перехватили здесь)
      const href = url.pathname + url.search + url.hash;
      try {
        const vt = doc.startViewTransition!(
          () =>
            new Promise<void>((resolve) => {
              finish.current = resolve;
              router.push(href);
              // Страховка: если pathname не сменится (уже там / отмена) — снять VT через таймаут.
              window.setTimeout(() => {
                if (finish.current === resolve) {
                  finish.current = null;
                  resolve();
                }
              }, 800);
            }),
        ) as { ready?: Promise<unknown>; finished?: Promise<unknown> } | undefined;
        // VT-промисы (.ready/.finished) РЕДЖЕКТЯТСЯ при прерывании перехода (быстрая навигация →
        // браузер пропускает текущий переход с AbortError). Не перехватишь → браузер бросает
        // unhandledRejection (виден в Next dev-overlay). Гасим — это штатное прерывание, не ошибка.
        void vt?.ready?.catch(() => {});
        void vt?.finished?.catch(() => {});
      } catch {
        router.push(href); // на всякий случай: навигация не должна ломаться из-за анимации
      }
    };

    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [router]);

  return null;
}
