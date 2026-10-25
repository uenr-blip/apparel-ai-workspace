"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

export function ReferenceBomForm({ orderId }: { orderId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");

  async function submit() {
    setPending(true);
    setMessage("");
    const response = await fetch(`/api/orders/${orderId}/reference-bom`, { method: "POST" });
    const body = (await response.json()) as { error?: string; message?: string };
    setPending(false);
    if (!response.ok) {
      setMessage(body.error || "引用失败");
      return;
    }
    setMessage(body.message || "已引用到本单草稿");
    router.refresh();
  }

  return (
    <div className="mt-4 space-y-2">
      <p className="text-xs leading-5 text-[var(--ink-muted)]">
        引用只写进本单草稿，已批准版本保持原样。单耗沿用已批准资料，本单资料仍未批准，不会下达采购。
      </p>
      <Button type="button" size="sm" variant="secondary" disabled={pending} onClick={() => void submit()}>
        {pending ? "引用中…" : "引用已批准面辅料"}
      </Button>
      {message ? <p className="text-sm leading-6">{message}</p> : null}
    </div>
  );
}
