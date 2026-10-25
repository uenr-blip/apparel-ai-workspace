"use client";

import { useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { labels } from "@/lib/labels";
import type { ProductionBoardRow } from "@/server/services/production-board";

const KINDS = ["started", "scrapped", "wip", "good", "rework"] as const;

function emptyGrid(row: ProductionBoardRow | undefined) {
  const next: Record<string, Record<string, string>> = {};
  if (!row) return next;
  for (const color of row.colorSize.colors) {
    next[color.colorName] = {};
    for (const code of row.colorSize.sizeCodes) next[color.colorName][code] = "";
    if (row.colorSize.sizeCodes.length === 0) next[color.colorName][""] = "";
  }
  return next;
}

function toPositiveInt(value: string) {
  if (value.trim() === "") return null;
  const qty = Number(value);
  return Number.isInteger(qty) && qty > 0 ? qty : null;
}

export function RecordProductionForm({ orders }: { orders: ProductionBoardRow[] }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [orderId, setOrderId] = useState(orders[0]?.orderId ?? "");
  const selected = useMemo(() => orders.find((order) => order.orderId === orderId) ?? orders[0], [orderId, orders]);
  const [grid, setGrid] = useState(() => emptyGrid(selected));
  if (!orders.length) return null;

  const sizeCodes = selected?.colorSize.sizeCodes ?? [];
  const colors = selected?.colorSize.colors ?? [];
  const hasMatrix = colors.length > 0;
  const lines = colors.flatMap((color) => {
    const codes = sizeCodes.length ? sizeCodes : [""];
    return codes
      .map((code) => {
        const quantity = toPositiveInt(grid[color.colorName]?.[code] ?? "");
        return quantity ? { colorName: color.colorName, sizeCode: code, quantity } : null;
      })
      .filter((line): line is { colorName: string; sizeCode: string; quantity: number } => Boolean(line));
  });
  const filled = lines.reduce((sum, line) => sum + line.quantity, 0);

  function chooseOrder(nextId: string) {
    const next = orders.find((order) => order.orderId === nextId);
    setOrderId(nextId);
    setGrid(emptyGrid(next));
    setMessage("");
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const currentOrderId = String(data.get("orderId") ?? "");
    setPending(true);
    setMessage("");
    const payload = hasMatrix
      ? {
          kind: String(data.get("kind") ?? ""),
          idempotencyKey: String(data.get("idempotencyKey") ?? ""),
          note: String(data.get("note") ?? ""),
          lines,
          quantity: filled,
        }
      : {
          kind: String(data.get("kind") ?? ""),
          quantity: Number(data.get("quantity")),
          idempotencyKey: String(data.get("idempotencyKey") ?? ""),
          note: String(data.get("note") ?? ""),
        };
    const response = await fetch(`/api/orders/${currentOrderId}/production-qty`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = (await response.json()) as { error?: string; message?: string };
    setPending(false);
    if (!response.ok) {
      setMessage(body.error || "登记失败");
      return;
    }
    setMessage(body.message || "产量已登记");
    form.reset();
    setGrid(emptyGrid(selected));
    router.refresh();
  }

  return (
    <form className="space-y-3" onSubmit={(event) => void submit(event)}>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="text-sm">
          <span className="mb-1 block text-xs text-[var(--ink-muted)]">订单</span>
          <select
            name="orderId"
            required
            value={orderId}
            onChange={(event) => chooseOrder(event.target.value)}
            className="h-11 w-full rounded-xl border border-[var(--line)] bg-[var(--field-solid)] px-3 text-sm"
          >
            {orders.map((order) => (
              <option key={order.orderId} value={order.orderId}>
                {order.orderNo}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-xs text-[var(--ink-muted)]">类型</span>
          <select
            name="kind"
            required
            defaultValue="started"
            className="h-11 w-full rounded-xl border border-[var(--line)] bg-[var(--field-solid)] px-3 text-sm"
          >
            {KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {labels.productionKind(kind)}
              </option>
            ))}
          </select>
        </label>
        {hasMatrix ? (
          <label className="text-sm">
            <span className="mb-1 block text-xs text-[var(--ink-muted)]">本次合计</span>
            <input
              readOnly
              value={filled || ""}
              placeholder="下面色尺合计"
              className="h-11 w-full rounded-xl border border-[var(--line)] bg-[var(--paper)] px-3 text-sm"
            />
          </label>
        ) : (
          <label className="text-sm">
            <span className="mb-1 block text-xs text-[var(--ink-muted)]">件数</span>
            <input
              name="quantity"
              type="number"
              min={1}
              step={1}
              required
              className="h-11 w-full rounded-xl border border-[var(--line)] bg-[var(--field-solid)] px-3 text-sm"
            />
          </label>
        )}
        <label className="text-sm">
          <span className="mb-1 block text-xs text-[var(--ink-muted)]">幂等键</span>
          <input
            name="idempotencyKey"
            required
            placeholder="重复提交只记一次"
            className="h-11 w-full rounded-xl border border-[var(--line)] bg-[var(--field-solid)] px-3 text-sm"
          />
        </label>
      </div>
      {hasMatrix ? (
        <div className="overflow-x-auto rounded-xl border border-[var(--line)] p-3">
          <p className="text-xs text-[var(--ink-muted)]">
            按本单颜色 × 尺码填。空格不算。加色在订单页，这里不加新颜色。不是开裁/车间/后整。
          </p>
          <table className="mt-3 min-w-[480px] w-full text-sm">
            <thead className="text-left text-[var(--ink-muted)]">
              <tr>
                <th className="py-1">颜色</th>
                <th>订单件数</th>
                {sizeCodes.map((code) => (
                  <th key={code}>{code}</th>
                ))}
                {!sizeCodes.length ? <th>件数</th> : null}
                <th>本行已填</th>
              </tr>
            </thead>
            <tbody>
              {colors.map((color) => {
                const codes = sizeCodes.length ? sizeCodes : [""];
                const rowFilled = codes.reduce((sum, code) => sum + (toPositiveInt(grid[color.colorName]?.[code] ?? "") ?? 0), 0);
                return (
                  <tr key={color.colorName} className="border-t border-[var(--line)]">
                    <td className="py-2">{color.colorName}</td>
                    <td>{color.ordered}</td>
                    {codes.map((code) => (
                      <td key={code || "qty"} className="pr-2">
                        <input
                          aria-label={`${color.colorName}${code ? ` ${code}` : ""}件数`}
                          inputMode="numeric"
                          value={grid[color.colorName]?.[code] ?? ""}
                          onChange={(event) =>
                            setGrid((current) => ({
                              ...current,
                              [color.colorName]: {
                                ...current[color.colorName],
                                [code]: event.target.value,
                              },
                            }))
                          }
                          className="h-10 w-20 rounded-lg border border-[var(--line)] bg-[var(--field-bg)] px-2"
                        />
                      </td>
                    ))}
                    <td>{rowFilled || "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-xs text-[var(--ink-muted)]">这一单还没有颜色件数，先在订单页补色尺，或先记整单件数。</p>
      )}
      <label className="block text-sm">
        <span className="mb-1 block text-xs text-[var(--ink-muted)]">备注（可选）</span>
        <input
          name="note"
          className="h-11 w-full rounded-xl border border-[var(--line)] bg-[var(--field-bg)] px-3 text-sm"
        />
      </label>
      <Button type="submit" size="sm" disabled={pending || (hasMatrix && filled <= 0)}>
        {pending ? "处理中…" : "登记产量"}
      </Button>
      {message ? (
        <p className={`text-sm ${/失败|无权|无效|空|必须|不在/.test(message) ? "text-[var(--danger)]" : "text-[var(--ok)]"}`}>
          {message}
        </p>
      ) : null}
    </form>
  );
}
