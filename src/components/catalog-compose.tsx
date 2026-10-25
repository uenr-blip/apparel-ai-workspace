"use client";

import { useId, useState, type ReactNode } from "react";
import { BoardDialog } from "@/components/board-dialog";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";

export function CatalogCompose({
  label,
  title,
  note,
  children,
  defaultOpen = false,
  assistant = false,
  variant = "primary",
}: {
  label: string;
  title: string;
  note?: string;
  children: ReactNode;
  defaultOpen?: boolean;
  assistant?: boolean;
  variant?: "primary" | "secondary" | "outline";
}) {
  const [open, setOpen] = useState(defaultOpen);
  const titleId = useId();

  return (
    <>
      <Button type="button" variant={assistant ? "secondary" : variant} className={assistant ? "border border-[var(--brand)]/30 shadow-none" : undefined} onClick={() => setOpen(true)}>
        {assistant ? <Sparkles size={16} aria-hidden="true" /> : null}
        {label}
      </Button>
      <BoardDialog open={open} title={title} note={note} titleId={titleId} onClose={() => setOpen(false)}>
        {children}
      </BoardDialog>
    </>
  );
}
