"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

export function InboundEtaForm({
  orderId,
  lots,
  canEdit,
}: {
  orderId: string;
  lots: Array<{ id: string; inboundNo: string | null; inboundEta: string | null; qtyInbound: string; materialCode: string }>;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  if (!lots.length) return null;

  async function submit(lot: (typeof lots)[number], inboundEta: string) {
    setPending(true);
    setMessage("");
    const response = await fetch(`/api/orders/${orderId}/inbound-eta`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lotId: lot.id, inboundEta, expectedEta: lot.inboundEta ?? "" }),
    });
    const body = (await response.json()) as { error?: string; message?: string };
    setPending(false);
    if (!response.ok) {
      setMessage(body.error || "核验失败");
      return;
    }
    setMessage(body.message || "在途日期已核验，未下达采购");
    router.refresh();
  }

  return (
    <div className="mt-4 space-y-2 border-t border-[var(--line)] pt-4">
      <h4 className="text-sm font-medium">核验在途到货日</h4>
      <p className="text-xs text-[var(--ink-muted)]">
        供应商通知不能自己改计划。经理核验后才更新 ETA；已采用的采购草稿会过期并按新日期重算，不会下达采购。
      </p>
      {lots.map((lot) => (
        <form
          key={lot.id}
          className="flex flex-wrap items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            const value = String(new FormData(event.currentTarget).get("inboundEta") ?? "");
            void submit(lot, value);
          }}
        >
          <label className="text-sm">
            <span className="mb-1 block text-xs text-[var(--ink-muted)]">
              {lot.materialCode} {lot.inboundNo ?? lot.id} · {lot.qtyInbound} 米在途
            </span>
            <input
              name="inboundEta"
              type="date"
              defaultValue={lot.inboundEta ?? ""}
              className="rounded-lg border border-[var(--line)] bg-white px-2 py-1 text-sm"
            />
          </label>
          <Button type="submit" size="sm" disabled={pending || !canEdit}>
            {pending ? "处理中…" : "核验到货日"}
          </Button>
        </form>
      ))}
      {!canEdit ? <p className="text-xs text-[var(--danger)]">当前角色无权核验在途日期</p> : null}
      {message ? (
        <p className={`text-sm ${/失败|无权|冲突|他人修改/.test(message) ? "text-[var(--danger)]" : "text-[var(--ok)]"}`}>
          {message}
        </p>
      ) : null}
    </div>
  );
}
