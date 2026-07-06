"use client";

import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { forwardRef } from "react";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded font-medium transition-colors duration-fast ease-ease focus-visible:outline focus-visible:outline-2 focus-visible:outline-info disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        // primary CTA — CROWN gold (status): brand gold, but not the bright money color (reserved for the final action)
        primary: "bg-status text-[#1a1206] hover:brightness-110",
        secondary:
          "border border-border bg-[var(--bg)] text-fg hover:border-border-strong hover:bg-surface-raised",
        ghost: "text-fg-muted hover:bg-surface-raised hover:text-fg",
        danger: "bg-danger text-[#1a0b0e] hover:brightness-110",
        // only for a CONFIRMED monetary action (design-system.md §2)
        money: "bg-money text-[#06140d] hover:brightness-110",
      },
      size: {
        // NOTE: in tailwind.config the spacing scale is overridden to --space-* (1–8), and this affects h-*.
        // --space-8=64px → h-8 would give 64px (a button taller than the header!). We take a height OUTSIDE the 1–8 range: h-9=36px.
        sm: "h-9 px-3 text-small",
        md: "h-10 px-4 text-small",
        lg: "h-12 px-6 text-body",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, loading = false, disabled, children, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        ref={ref}
        className={cn(buttonVariants({ variant, size }), className)}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        {...props}
      >
        {/* Slot requires EXACTLY one child → with asChild we pass children as-is
            (the loading spinner only in real-button mode). */}
        {asChild ? (
          children
        ) : (
          <>
            {loading ? <Spinner /> : null}
            {children}
          </>
        )}
      </Comp>
    );
  },
);
Button.displayName = "Button";

function Spinner() {
  return (
    <svg
      className="h-4 w-4 animate-spin"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path
        className="opacity-90"
        fill="currentColor"
        d="M4 12a8 8 0 0 1 8-8v4a4 4 0 0 0-4 4H4z"
      />
    </svg>
  );
}

export { buttonVariants };
