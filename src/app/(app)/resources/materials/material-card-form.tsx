"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

export function MaterialCardForm({
  materialId,
  canEdit,
  composition,
  gsm,
  widthCm,
  specSummary,
}: {
  materialId: string;
  canEdit: boolean;
  composition: string;
  gsm: string;
  widthCm: string;
  specSummary: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");

  if (!canEdit) return null;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setPending(true);
    setMessage("");
    const response = await fetch(`/api/materials/${materialId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        composition: String(data.get("composition") ?? ""),
        gsm: String(data.get("gsm") ?? ""),
        widthCm: String(data.get("widthCm") ?? ""),
        specSummary: String(data.get("specSummary") ?? ""),
      }),
    });
    const body = (await response.json()) as { error?: string; message?: string };
    setPending(false);
    if (!response.ok) {
      setMessage(body.error || "更新失败");
      return;
    }
    setMessage(body.message || "已更新");
    router.refresh();
  }

  return (
    <form className="mt-4 space-y-3" onSubmit={(event) => void submit(event)}>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm">
          <span className="mb-1 block text-xs text-[var(--ink-muted)]">成分</span>
          <input name="composition" defaultValue={composition} className="h-11 w-full rounded-xl border border-[var(--line)] bg-[var(--field-bg)] px-3 text-sm" />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-xs text-[var(--ink-muted)]">克重 g/m²</span>
          <input name="gsm" defaultValue={gsm} inputMode="decimal" className="h-11 w-full rounded-xl border border-[var(--line)] bg-[var(--field-bg)] px-3 text-sm" />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-xs text-[var(--ink-muted)]">幅宽 cm</span>
          <input name="widthCm" defaultValue={widthCm} inputMode="decimal" className="h-11 w-full rounded-xl border border-[var(--line)] bg-[var(--field-bg)] px-3 text-sm" />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-xs text-[var(--ink-muted)]">规格（兜底）</span>
          <input name="specSummary" defaultValue={specSummary} className="h-11 w-full rounded-xl border border-[var(--line)] bg-[var(--field-bg)] px-3 text-sm" />
        </label>
      </div>
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "保存中…" : "更新卡片"}
      </Button>
      {message ? (
        <p className={`text-sm ${/失败|无权|须为/.test(message) ? "text-[var(--danger)]" : "text-[var(--ok)]"}`}>{message}</p>
      ) : null}
    </form>
  );
}
