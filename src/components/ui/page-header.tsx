import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  compact = false,
  inline = false,
}: {
  eyebrow?: string;
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  compact?: boolean;
  inline?: boolean;
}) {
  return (
    <header className={cn("flex flex-wrap items-end justify-between", compact || inline ? "gap-3" : "gap-5")}>
      <div className="max-w-3xl">
        {eyebrow ? (
          <p className="text-[11px] font-medium tracking-[0.26em] text-[var(--ink-muted)]">{eyebrow}</p>
        ) : null}
        <h2
          className={cn(
            "font-[family-name:var(--font-display)] font-normal leading-[1.2] text-[var(--ink)]",
            compact || inline ? "text-[1.55rem] md:text-[1.75rem]" : "mt-2 text-[2rem] md:text-[2.4rem]",
            eyebrow && (compact || inline) && "mt-1",
            eyebrow && !compact && !inline && "mt-2",
            inline && "flex flex-wrap items-baseline gap-x-3 gap-y-1",
          )}
        >
          <span>{title}</span>
          {inline && description ? (
            <span className="font-[family-name:var(--font-sans)] text-sm font-normal text-[var(--ink-muted)]">
              {description}
            </span>
          ) : null}
        </h2>
        {!inline && description ? (
          <div className={cn("max-w-2xl text-sm text-[var(--ink-muted)]", compact ? "mt-1 leading-6" : "mt-2.5 leading-7")}>
            {description}
          </div>
        ) : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}

export function SectionTitle({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <h3 className={cn("font-[family-name:var(--font-display)] text-[1.15rem] font-normal tracking-[0.02em] text-[var(--ink)]", className)}>
      {children}
    </h3>
  );
}
