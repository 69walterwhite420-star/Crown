"use client";

import { useEffect, useRef, useState } from "react";

/**
 * A "copied" flag with auto-reset. The timer is cleared on unmount — otherwise `setCopied(false)`
 * would fire on an already-unmounted component (closed menu / navigating away). Returns [copied, mark]:
 * `mark()` is called after a successful `clipboard.writeText`.
 */
export function useCopied(resetMs = 1500): [boolean, () => void] {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const mark = () => {
    setCopied(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), resetMs);
  };
  return [copied, mark];
}
