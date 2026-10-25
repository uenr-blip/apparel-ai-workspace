"use client";

import { useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import type { ProductionBoardRow } from "@/server/services/production-board";

type LineRow = { cartonNo: string; colorName: string; sizeCode: string; quantity: string };

const LEFTOVER_005: LineRow[] = [
  { cartonNo: "C-L1", colorName: "海军蓝", sizeCode: "S", quantity: "4" },
  { cartonNo: "C-L1", colorName: "海军蓝", sizeCode: "M", quantity: "3" },
  { cartonNo: "C-L1", colorName: "灰色", sizeCode: "S", quantity: "2" },
  { cartonNo: "C-L1", colorName: "灰色", sizeCode: "M", quantity: "1" },
  { cartonNo: "C-L2", colorName: "海军蓝", sizeCode: "L", quantity: "3" },
  { cartonNo: "C-L2", colorName: "灰色", sizeCode: "L", quantity: "2" },
];

function linesForOrder(order: ProductionBoardRow | undefined): LineRow[] {
  if (!order) return [{ cartonNo: "C-1", colorName: "", sizeCode: "", quantity: "" }];
  if (order.orderNo === "DEMO-ORD-005") return LEFTOVER_005;
  const rows = order.colorSize.colors.flatMap((color) =>
    (order.colorSize.sizeCodes.length ? order.colorSize.sizeCodes : [""]).map((sizeCode) => ({
      cartonNo: "C-1",
      colorName: color.colorName,
      sizeCode,
      quantity: "",
    })),
  );
  return rows.length ? rows : [{ cartonNo: "C-1", colorName: "", sizeCode: "", quantity: "" }];
}

export function CreatePackingForm({ orders }: { orders: ProductionBoardRow[] }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const packable = useMemo(() => orders.filter((order) => order.canPackDraft), [orders]);
  const [orderId, setOrderId] = useState(packable[0]?.orderId ?? "");
  const selected = packable.find((order) => order.orderId === orderId) ?? packable[0];
  const [lines, setLines] = useState<LineRow[]>(() => linesForOrder(selected));
  if (!packable.length) return null;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const orderId = String(data.get("orderId") ?? "");
    const cartonsMap = new Map<string, LineRow[]>();
    for (const line of lines) {
      const cartonNo = line.cartonNo.trim();
      const colorName = line.colorName.trim();
      const sizeCode = line.sizeCode.trim();
      const quantity = Number(line.quantity);
      if (!cartonNo || !colorName || !Number.isInteger(quantity) || quantity <= 0) continue;
      const bucket = cartonsMap.get(cartonNo) ?? [];
      bucket.push({ cartonNo, colorName, sizeCode, quantity: String(quantity) });
      cartonsMap.set(cartonNo, bucket);
    }
    const cartons = [...cartonsMap.entries()].map(([cartonNo, cartonLines]) => ({
      cartonNo,
      lines: cartonLines.map((line) => ({
        colorName: line.colorName,
        sizeCode: line.sizeCode,
        quantity: Number(line.quantity),
      })),
    }));
    setPending(true);
    setMessage("");
    const response = await fetch(`/api/orders/${orderId}/packing`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        cartons,
        idempotencyKey: String(data.get("idempotencyKey") ?? ""),
        note: String(data.get("note") ?? ""),
      }),
    });
    const body = (await response.json()) as { error?: string; message?: string };
    setPending(false);
    if (!response.ok) {
      setMessage(body.error || "保存失败");
      return;
    }
    setMessage(body.message || "装箱草稿已保存");
    form.reset();
    router.refresh();
  }

  return (
    <form className="space-y-3" onSubmit={(event) => void submit(event)}>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <label className="text-sm">
          <span className="mb-1 block text-xs text-[var(--ink-muted)]">订单</span>
          <select
            name="orderId"
            required
            aria-label="装箱订单"
            value={orderId}
            onChange={(event) => {
              const nextId = event.target.value;
              const next = packable.find((order) => order.orderId === nextId);
              setOrderId(nextId);
              setLines(linesForOrder(next));
            }}
            className="h-11 w-full rounded-xl border border-[var(--line)] bg-[var(--field-solid)] px-3 text-sm"
          >
            {packable.map((order) => (
              <option key={order.orderId} value={order.orderId}>
                {order.orderNo} · 可发 {order.packable}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-xs text-[var(--ink-muted)]">幂等键</span>
          <input
            name="idempotencyKey"
            required
            defaultValue="pack-leftover-15"
            className="h-11 w-full rounded-xl border border-[var(--line)] bg-[var(--field-solid)] px-3 text-sm"
          />
        </label>
        <label className="text-sm sm:col-span-2 lg:col-span-1">
          <span className="mb-1 block text-xs text-[var(--ink-muted)]">备注</span>
          <input
            name="note"
            defaultValue="余货混装草稿"
            className="h-11 w-full rounded-xl border border-[var(--line)] bg-[var(--field-solid)] px-3 text-sm"
          />
        </label>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-[640px] w-full text-sm">
          <thead className="text-left text-[var(--ink-muted)]">
            <tr>
              <th className="py-1">箱号</th>
              <th>颜色</th>
              <th>尺码</th>
              <th>件数</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line, index) => (
              <tr key={index} className="border-t border-[var(--line)]">
                <td className="py-2 pr-2">
                  <input
                    aria-label={`箱号${index + 1}`}
                    value={line.cartonNo}
                    onChange={(event) =>
                      setLines((current) => current.map((item, i) => (i === index ? { ...item, cartonNo: event.target.value } : item)))
                    }
                    className="h-10 w-full rounded-lg border border-[var(--line)] bg-[var(--field-bg)] px-2"
                  />
                </td>
                <td className="pr-2">
                  <input
                    aria-label={`颜色${index + 1}`}
                    list={`pack-color-${selected?.orderId ?? "none"}`}
                    value={line.colorName}
                    onChange={(event) =>
                      setLines((current) => current.map((item, i) => (i === index ? { ...item, colorName: event.target.value } : item)))
                    }
                    className="h-10 w-full rounded-lg border border-[var(--line)] bg-[var(--field-bg)] px-2 text-[var(--ink)]"
                  />
                </td>
                <td className="pr-2">
                  <input
                    aria-label={`尺码${index + 1}`}
                    list={`pack-size-${selected?.orderId ?? "none"}`}
                    value={line.sizeCode}
                    onChange={(event) =>
                      setLines((current) => current.map((item, i) => (i === index ? { ...item, sizeCode: event.target.value } : item)))
                    }
                    className="h-10 w-full rounded-lg border border-[var(--line)] bg-[var(--field-bg)] px-2 text-[var(--ink)]"
                  />
                </td>
                <td>
                  <input
                    aria-label={`件数${index + 1}`}
                    inputMode="numeric"
                    value={line.quantity}
                    onChange={(event) =>
                      setLines((current) => current.map((item, i) => (i === index ? { ...item, quantity: event.target.value } : item)))
                    }
                    className="h-10 w-full rounded-lg border border-[var(--line)] bg-[var(--field-bg)] px-2"
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <datalist id={`pack-color-${selected?.orderId ?? "none"}`}>
          {(selected?.colorSize.colors ?? []).map((color) => (
            <option key={color.colorName} value={color.colorName} />
          ))}
        </datalist>
        <datalist id={`pack-size-${selected?.orderId ?? "none"}`}>
          {(selected?.colorSize.sizeCodes ?? []).map((code) => (
            <option key={code} value={code} />
          ))}
        </datalist>
      </div>
      <Button
        type="button"
        size="sm"
        variant="secondary"
        onClick={() => setLines((current) => [...current, { cartonNo: current.at(-1)?.cartonNo || "C-1", colorName: "", sizeCode: "", quantity: "" }])}
      >
        加一行
      </Button>
      {message ? <p className="text-sm text-[var(--ink-muted)]">{message}</p> : null}
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "保存中…" : "保存装箱草稿"}
      </Button>
    </form>
  );
}
