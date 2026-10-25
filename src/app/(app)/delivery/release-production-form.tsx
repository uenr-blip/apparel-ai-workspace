"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { labels } from "@/lib/labels";

export function ReleaseProductionForm({
  canRelease,
  orders,
}: {
  canRelease: boolean;
  orders: Array<{
    orderId: string;
    orderNo: string;
    styleCodes: string;
    factoryName: string;
    readiness: string;
  }>;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [orderId, setOrderId] = useState(orders[0]?.orderId ?? "");

  if (!canRelease) {
    return (
      <p className="text-sm leading-6 text-[var(--ink-muted)]">
        当前角色不能批准投产。生产从已有订单来，不另开车间生产单。门槛齐后由经理在本页或订单页放行。
      </p>
    );
  }

  if (!orders.length) {
    return (
      <p className="text-sm leading-6 text-[var(--ink-muted)]">
        现在没有待投产的订单。草稿、已投产和已出运的不会出现在这里。去订单页把资料、分色和厂里有料齐了再来。
      </p>
    );
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!orderId) return;
    setPending(true);
    setMessage("");
    const response = await fetch(`/api/orders/${orderId}/release`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const body = (await response.json()) as { error?: string; message?: string };
    setPending(false);
    if (!response.ok) {
      setMessage(body.error || "批准投产失败");
      return;
    }
    setMessage(body.message || "已批准投产");
    router.refresh();
  }

  const selected = orders.find((item) => item.orderId === orderId) ?? orders[0];

  return (
    <form className="space-y-3" onSubmit={(event) => void submit(event)}>
      <p className="text-sm leading-6 text-[var(--ink-muted)]">
        选定已有订单放进厂里。不另开车间生产单。资料、分色、厂里有料都齐才能过。正式采购仍未下达。
      </p>
      <label className="block text-sm">
        订单
        <select
          value={orderId}
          onChange={(event) => setOrderId(event.target.value)}
          className="mt-1 w-full rounded-xl border border-[var(--line)] bg-[var(--field-solid)] px-3 py-2"
        >
          {orders.map((item) => (
            <option key={item.orderId} value={item.orderId}>
              {item.orderNo} · {item.styleCodes || "未挂款"} · {labels.readiness(item.readiness)}
            </option>
          ))}
        </select>
      </label>
      {selected ? (
        <p className="text-sm text-[var(--ink-muted)]">
          {selected.factoryName}。
          <Link href={`/orders/${selected.orderId}#production-gate`} className="ml-1 text-[var(--brand-strong)]">
            看本单门槛
          </Link>
        </p>
      ) : null}
      {message ? (
        <p className={`text-sm ${/失败|无权|不能/.test(message) ? "text-[var(--danger)]" : "text-[var(--ok)]"}`}>{message}</p>
      ) : null}
      <Button type="submit" disabled={pending || !orderId}>
        {pending ? "处理中…" : "批准投产"}
      </Button>
    </form>
  );
}
