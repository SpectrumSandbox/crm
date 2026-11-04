import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/**
 * Buttons follow spectrumgroup.id: solid white CTA with 3px radius ("Our capabilities →"),
 * outline pill ("Let's collaborate →"), and quiet text links in --muted.
 */
const buttonVariants = cva(
  "inline-flex select-none items-center justify-center gap-1.5 whitespace-nowrap font-semibold tracking-cta transition-colors duration-150 ease-sg disabled:pointer-events-none disabled:opacity-40 [&_svg]:shrink-0",
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

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant, size, type = "button", ...props }, ref) => (
  <button ref={ref} type={type} className={cn(buttonVariants({ variant, size }), className)} {...props} />
));
Button.displayName = "Button";

export { buttonVariants };
