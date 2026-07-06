"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

/**
 * Cross-fade between pages via the native View Transitions API. We intercept a click on an INTERNAL link
 * in the capture phase and wrap the navigation in `document.startViewTransition` → the browser cross-fades
 * the snapshots itself (the old page fades out, the new one fades in). We resolve the VT promise once the
 * navigation has actually applied (the pathname changed).
 *
 * Safety: if the API isn't supported — we intercept NOTHING (regular Next navigation). We only intercept
 * "clean" left-clicks on internal links (no modifiers, target, download, foreign origin, and no hash-only).
 * We don't affect anything else. The component mounts once in the layout; easy to remove.
 */
export function PageTransitions() {
  const router = useRouter();
  const pathname = usePathname();
  const finish = useRef<(() => void) | null>(null);

  // Navigation applied → close the pending VT (the browser will grab a new frame and finish the cross-fade).
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
    if (typeof doc.startViewTransition !== "function") return; // not supported → regular navigation

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
      if (url.origin !== location.origin) return; // external link — leave it alone
      // Same page (hash/anchor only) — don't intercept, let it work normally.
      if (url.pathname === location.pathname && url.search === location.search) return;

      e.preventDefault();
      e.stopPropagation(); // prevent Link from navigating again (we've intercepted it here)
      const href = url.pathname + url.search + url.hash;
      try {
        const vt = doc.startViewTransition!(
          () =>
            new Promise<void>((resolve) => {
              finish.current = resolve;
              router.push(href);
              // Safety net: if the pathname doesn't change (already there / cancelled) — drop the VT on a timeout.
              window.setTimeout(() => {
                if (finish.current === resolve) {
                  finish.current = null;
                  resolve();
                }
              }, 800);
            }),
        ) as { ready?: Promise<unknown>; finished?: Promise<unknown> } | undefined;
        // The VT promises (.ready/.finished) REJECT when the transition is interrupted (fast navigation →
        // the browser skips the current transition with an AbortError). If you don't catch it → the browser
        // throws an unhandledRejection (visible in the Next dev overlay). We swallow it — this is a normal
        // interruption, not an error.
        void vt?.ready?.catch(() => {});
        void vt?.finished?.catch(() => {});
      } catch {
        router.push(href); // just in case: navigation must not break because of the animation
      }
    };

    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [router]);

  return null;
}
