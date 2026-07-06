"use client";

import { useRef, useState } from "react";
import { SearchIcon, XIcon } from "@/components/ui/icons";
import { cn } from "@/lib/utils";

/**
 * A compact magnifier that grows into a full search field on click/focus (width animation); filters the list
 * live. Collapses back into an icon on blur if empty. Respects reduced-motion (a global rule in
 * globals.css neutralizes the transition). A shared control: the realm catalog on the home page and the realm feed.
 */
export function ExpandingSearch({
  value,
  onChange,
  placeholder = "Search…",
  label = "Search",
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  label?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [focused, setFocused] = useState(false);
  const expanded = focused || value.length > 0;

  return (
    <div
      className={cn(
        "relative flex h-10 flex-none items-center transition-[width] duration-slow ease-ease",
        expanded ? "w-52 sm:w-72" : "w-10",
      )}
    >
      <button
        type="button"
        aria-label={label}
        onClick={() => inputRef.current?.focus()}
        className="absolute left-0 z-10 grid h-10 w-10 flex-none place-items-center text-fg-faint transition-colors hover:text-fg"
      >
        <SearchIcon className="h-[18px] w-[18px]" />
      </button>
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        placeholder={placeholder}
        aria-label={label}
        className={cn(
          "h-10 w-full rounded-lg border bg-surface pl-10 pr-9 text-small text-fg outline-none",
          "transition-[opacity,border-color] duration-slow ease-ease placeholder:text-fg-faint",
          expanded
            ? "border-border opacity-100 focus:border-border-strong"
            : "cursor-pointer border-transparent bg-transparent opacity-0",
        )}
      />
      {value.length > 0 ? (
        <button
          type="button"
          aria-label="Clear"
          onClick={() => {
            onChange("");
            inputRef.current?.focus();
          }}
          className="absolute right-0 z-10 grid h-10 w-10 flex-none place-items-center text-fg-faint transition-colors hover:text-fg"
        >
          <XIcon className="h-4 w-4" />
        </button>
      ) : null}
    </div>
  );
}
