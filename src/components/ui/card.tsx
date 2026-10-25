import type { HTMLAttributes } from "react";
import { cn } from "@/lib/cn";

export function Card({
  className,
  lift = false,
  ...props
}: HTMLAttributes<HTMLDivElement> & { lift?: boolean }) {
  return (
    <div
      className={cn(
        "business-card rounded-[var(--radius)] border border-[var(--card-border)] bg-[var(--surface-solid)]/80 shadow-[var(--shadow-float)] backdrop-blur-md",
        lift && "lift",
        className,
      )}
      {...props}
    />
  );
}

export function Badge({
  tone = "neutral",
  className,
  ...props
}: HTMLAttributes<HTMLSpanElement> & { tone?: "neutral" | "brand" | "warning" | "danger" | "ok" | "ai" }) {
  const tones = {
    neutral: "bg-[var(--paper-2)] text-[var(--ink-muted)]",
    brand: "bg-[var(--brand-soft)] text-[var(--brand-strong)]",
    warning: "bg-[#f8e6d8] text-[var(--warning)]",
    danger: "bg-[#f8d7d3] text-[var(--danger)]",
    ok: "bg-[#dceee0] text-[var(--ok)]",
    ai: "bg-[#e7edf3] text-[var(--ai)]",
  };
  return (
    <span
      className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold tracking-wide", tones[tone], className)}
      {...props}
    />
  );
}
