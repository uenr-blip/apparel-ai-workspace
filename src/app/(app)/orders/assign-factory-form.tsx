"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

export function AssignFactoryForm({
  orderId,
  factoryId,
  factories,
  canEdit,
}: {
  orderId: string;
  factoryId: string | null;
  factories: Array<{ id: string; name: string }>;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  if (!canEdit) {
    return <p className="text-sm text-[var(--ink-muted)]">当前角色不能改派工厂。</p>;
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const next = String(data.get("factoryId") ?? "");
    setPending(true);
    setMessage("");
    const response = await fetch(`/api/orders/${orderId}/factory`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ factoryId: next || null }),
    });
    const body = (await response.json()) as { error?: string; message?: string };
    setPending(false);
    if (!response.ok) {
      setMessage(body.error || "指派失败");
      return;
    }
    setMessage(body.message || "已指派工厂");
    router.refresh();
  }

  return (
    <form className="space-y-2" onSubmit={(event) => void submit(event)}>
      <label className="block text-sm">
        <span className="mb-1 block text-xs text-[var(--ink-muted)]">生产工厂</span>
        <select
          name="factoryId"
          aria-label="生产工厂"
          defaultValue={factoryId ?? ""}
          className="h-11 w-full rounded-xl border border-[var(--line)] bg-[var(--field-solid)] px-3 text-sm"
        >
          <option value="">未指定工厂</option>
          {factories.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
      </label>
      {message ? <p className="text-sm text-[var(--ink-muted)]">{message}</p> : null}
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "保存中…" : "保存工厂"}
      </Button>
    </form>
  );
}
