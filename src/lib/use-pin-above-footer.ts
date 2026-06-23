import { useEffect, useRef } from "react";

/**
 * Панель «прибита» к экрану (position: fixed задаётся в CSS), но НЕ должна заходить на футер. При подходе
 * футера приподнимаем панель через translateY ровно настолько, чтобы её низ упирался в верх футера и дальше
 * ехал вместе с ним (как «удар об футер» у sticky, но без раннего отрыва от потока). Когда футер далеко —
 * transform пустой, панель стоит на месте. Работает только пока панель реально fixed (на мобиле — no-op).
 */
export function usePinAboveFooter<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useEffect(() => {
    const el = ref.current;
    const footer = document.querySelector("footer");
    if (!el || !footer) return;

    let raf = 0;
    const apply = () => {
      raf = 0;
      const cs = getComputedStyle(el);
      if (cs.position !== "fixed") {
        if (el.style.transform) el.style.transform = "";
        return;
      }
      const top = parseFloat(cs.top) || 0; // используемое значение calc(...) в px
      const height = el.offsetHeight; // не зависит от translateY
      const footerTop = footer.getBoundingClientRect().top;
      const overlap = top + height - footerTop; // насколько низ панели залез бы на футер
      const next = overlap > 0 ? `translateY(${-overlap}px)` : "";
      if (el.style.transform !== next) el.style.transform = next;
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(apply);
    };

    apply();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  return ref;
}
