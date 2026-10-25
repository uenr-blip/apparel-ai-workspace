import type { InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

const fieldClass =
  "h-11 w-full rounded-xl border border-[var(--line)] bg-[var(--field-bg)] px-3 text-sm text-[var(--ink)] outline-none shadow-[var(--field-inset)] transition-shadow placeholder:text-[var(--ink-muted)] focus:border-[var(--brand)] focus:ring-2 focus:ring-[var(--gold)]/25";

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        fieldClass,
        className,
      )}
      {...props}
    />
  );
}

const selectClass =
  "h-11 w-full rounded-xl border border-[var(--line)] bg-[var(--field-solid)] px-3 text-sm text-[var(--ink)] outline-none shadow-[var(--field-inset)] transition-shadow focus:border-[var(--brand)] focus:ring-2 focus:ring-[var(--gold)]/25";

export function Select({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cn(selectClass, className)} {...props}>
      {children}
    </select>
  );
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(
        "min-h-[140px] w-full rounded-xl border border-[var(--line)] bg-[var(--field-bg)] px-3 py-2 text-sm leading-6 text-[var(--ink)] outline-none shadow-[var(--field-inset)] transition-shadow placeholder:text-[var(--ink-muted)] focus:border-[var(--brand)] focus:ring-2 focus:ring-[var(--gold)]/25",
        className,
      )}
      {...props}
    />
  );
}
