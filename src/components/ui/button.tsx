import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";
import { cn } from "@/lib/cn";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 rounded-xl text-sm font-semibold transition-all disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--paper)]",
  {
    variants: {
      variant: {
        primary:
          "bg-[var(--brand)] text-[var(--on-brand)] shadow-[0_1px_0_rgba(255,255,255,0.22)_inset,0_12px_28px_rgba(29,49,44,0.28)] hover:bg-[var(--brand-strong)] hover:text-[var(--on-brand)]",
        secondary: "bg-[var(--brand-soft)] text-[var(--brand-strong)] hover:bg-white/70",
        ghost: "hover:bg-white/50 text-[var(--ink)]",
        danger: "bg-[var(--danger)] text-white hover:bg-[#8f1c14]",
        outline: "border border-[var(--line-strong)] bg-white/50 hover:bg-white/80",
      },
      size: {
        sm: "h-8 px-3",
        md: "h-10 px-4",
        lg: "h-11 px-5",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export const Button = React.forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof buttonVariants>
>(({ className, variant, size, ...props }, ref) => (
  <button ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props} />
));
Button.displayName = "Button";
