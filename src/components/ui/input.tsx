"use client";

import { forwardRef, useId } from "react";
import { cn } from "@/lib/utils";

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  helper?: string;
  error?: string;
  /** Моноширинный режим для сумм/адресов (design-system.md §3). */
  mono?: boolean;
  /** Мини-иконка слева внутри поля (напр. лупа для поиска). */
  icon?: React.ReactNode;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, label, helper, error, mono, icon, id, ...props }, ref) => {
    const autoId = useId();
    const inputId = id ?? autoId;
    return (
      <div className="flex flex-col gap-1.5">
        {label ? (
          <label htmlFor={inputId} className="text-small text-fg-muted">
            {label}
          </label>
        ) : null}
        <div className="relative">
          {icon ? (
            <span className="pointer-events-none absolute left-3 top-1/2 flex -translate-y-1/2 text-fg-faint">
              {icon}
            </span>
          ) : null}
          <input
            id={inputId}
            ref={ref}
            aria-invalid={error ? true : undefined}
            className={cn(
              "h-10 w-full rounded border border-border bg-[var(--bg)] px-3 text-body text-fg placeholder:text-fg-faint",
              "transition-colors duration-fast ease-ease focus-visible:outline focus-visible:outline-2 focus-visible:outline-info",
              icon && "pl-9",
              mono && "mono tabular-nums",
              error && "border-danger",
              className,
            )}
            {...props}
          />
        </div>
        {error ? (
          <span className="text-small text-danger">{error}</span>
        ) : helper ? (
          <span className="text-small text-fg-faint">{helper}</span>
        ) : null}
      </div>
    );
  },
);
Input.displayName = "Input";
