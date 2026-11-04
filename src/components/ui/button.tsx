"use client";

import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/**
 * Buttons follow spectrumgroup.id: solid white CTA with 3px radius ("Our capabilities →"),
 * outline pill ("Let's collaborate →"), and quiet text links in --muted.
 */
const buttonVariants = cva(
  "inline-flex select-none items-center justify-center gap-1.5 whitespace-nowrap font-semibold tracking-cta transition-colors duration-150 ease-sg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sg-white/70 focus-visible:ring-offset-1 focus-visible:ring-offset-sg-bg disabled:pointer-events-none disabled:opacity-40 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary: "rounded bg-sg-white text-sg-bg hover:bg-sg-text",
        outline: "rounded border border-sg-line-2 text-sg-text hover:border-sg-white hover:text-sg-white",
        pill: "rounded-pill border border-sg-white text-sg-white hover:bg-sg-white hover:text-sg-bg",
        ghost: "rounded text-sg-muted hover:bg-sg-card-2 hover:text-sg-white",
        subtle: "rounded bg-sg-card-2 text-sg-text hover:bg-sg-card-3 hover:text-sg-white",
        danger: "rounded border border-soft-red/40 text-soft-red hover:bg-soft-red/10",
      },
      size: {
        xs: "h-6 px-2 text-2xs [&_svg]:size-3",
        sm: "h-7 px-2.5 text-xs [&_svg]:size-3.5",
        md: "h-8 px-3.5 text-sm [&_svg]:size-4",
        lg: "h-10 px-[26px] text-sm [&_svg]:size-4",
        icon: "size-7 [&_svg]:size-4",
        "icon-sm": "size-6 [&_svg]:size-3.5",
      },
    },
    defaultVariants: { variant: "subtle", size: "md" },
  },
);

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {}

const warned = new Set<string>();

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant, size, type = "button", ...props }, ref) => {
  const local = React.useRef<HTMLButtonElement | null>(null);
  const setRef = React.useCallback(
    (el: HTMLButtonElement | null) => {
      local.current = el;
      if (typeof ref === "function") ref(el);
      else if (ref) ref.current = el;
    },
    [ref],
  );
  const iconOnly = size === "icon" || size === "icon-sm";
  const named = !!(props["aria-label"] || props["aria-labelledby"] || props.title);
  React.useEffect(() => {
    if (process.env.NODE_ENV === "production" || !iconOnly || named) return;
    const el = local.current;
    // visible or sr-only text inside the button also gives it an accessible name
    if (!el || el.textContent?.trim()) return;
    const sig = el.outerHTML.slice(0, 160);
    if (warned.has(sig)) return;
    warned.add(sig);
    console.warn("[Button] icon-only button has no accessible name — pass aria-label or title.", el);
  }, [iconOnly, named]);
  return <button ref={setRef} type={type} className={cn(buttonVariants({ variant, size }), className)} {...props} />;
});
Button.displayName = "Button";

export { buttonVariants };
