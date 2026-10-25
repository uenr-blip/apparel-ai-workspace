import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/cn";

export function SheetHead({
  title,
  hint,
  action,
  className,
}: {
  title: string;
  hint?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-start justify-between gap-3", className)}>
      <div className="min-w-0 max-w-2xl">
        <h3 className="font-[family-name:var(--font-display)] text-[1.15rem] font-normal tracking-[0.02em] text-[var(--ink)]">
          {title}
        </h3>
        {hint ? <div className="mt-1.5 text-xs leading-6 text-[var(--ink-muted)]">{hint}</div> : null}
      </div>
      {action}
    </div>
  );
}

export function Tile({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("tile", className)} {...props} />;
}

export function Fold({
  id,
  title,
  children,
  className,
}: {
  id?: string;
  title: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <details id={id} className={cn("fold", className)}>
      <summary>{title}</summary>
      <div className="fold-body">{children}</div>
    </details>
  );
}
