"use client";

import { useId, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { labels } from "@/lib/labels";
import type { ProductionBoardRow, ProductionPackingCarton } from "@/server/services/production-board";
import { BoardDialog } from "./board-dialog";

export function PackingDialog({ row }: { row: ProductionBoardRow }) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const titleId = useId();
  const router = useRouter();

  async function act(planId: string, kind: "occupy" | "ship") {
    setPending(`${kind}:${planId}`);
    setMessage("");
    const response = await fetch(`/api/packing/${planId}/${kind}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idempotencyKey: `${kind}-${planId}` }),
    });
    const body = (await response.json()) as { error?: string; message?: string };
    setPending(null);
    if (!response.ok) {
      setMessage(body.error || "操作失败");
      return;
    }
    setMessage(body.message || "已保存");
    router.refresh();
  }

  return (
    <>
      <Button type="button" size="sm" variant="secondary" aria-label={`${row.orderNo} 装箱`} onClick={() => setOpen(true)}>
        装箱
      </Button>
      <BoardDialog
        open={open}
        title={`${row.orderNo} 装箱`}
        note={`已发运 ${row.shipped} · 余货 ${row.leftover} · 占用 ${row.occupied} · 可发 ${row.packable}。草稿不算实发。`}
        titleId={titleId}
        closeLabel="关闭装箱弹窗"
        onClose={() => setOpen(false)}
      >
            {row.packing.plans.length ? (
              <div className="mt-4 space-y-4">
                {row.packing.plans.map((plan) => (
                  <div key={plan.id} className="rounded-xl border border-[var(--line)] p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm">
                        {labels.packingStatus(plan.status)} · {plan.total} 件
                      </p>
                      <div className="flex gap-2">
                        {plan.status === "draft" && row.canOccupy ? (
                          <Button
                            type="button"
                            size="sm"
                            variant="secondary"
                            disabled={pending !== null}
                            onClick={() => void act(plan.id, "occupy")}
                          >
                            {pending === `occupy:${plan.id}` ? "占用中…" : "确认占用"}
                          </Button>
                        ) : null}
                        {plan.status === "occupied" && row.canShip ? (
                          <Button
                            type="button"
                            size="sm"
                            disabled={pending !== null}
                            onClick={() => void act(plan.id, "ship")}
                          >
                            {pending === `ship:${plan.id}` ? "出运中…" : "确认出运"}
                          </Button>
                        ) : null}
                      </div>
                    </div>
                    <div className="mt-3 overflow-x-auto">
                      <table className="min-w-[520px] w-full text-sm">
                        <thead className="text-left text-[var(--ink-muted)]">
                          <tr>
                            <th className="py-1">箱号</th>
                            <th>颜色</th>
                            <th>尺码</th>
                            <th>件数</th>
                            <th>箱合计</th>
                            <th>重量</th>
                          </tr>
                        </thead>
                        <tbody>
                          {plan.cartons.flatMap((carton) =>
                            carton.lines.map((line, index) => (
                              <tr key={`${carton.cartonNo}-${line.colorName}-${line.sizeCode}`} className="border-t border-[var(--line)]">
                                <td className="py-2">{index === 0 ? carton.cartonNo : ""}</td>
                                <td>{line.colorName}</td>
                                <td>{line.sizeCode}</td>
                                <td>{line.quantity}</td>
                                <td>{index === 0 ? carton.qty : ""}</td>
                                <td>{index === 0 ? `${labels.weightStatus(carton.weightStatus)}${carton.netWeight ? ` 净${carton.netWeight}` : ""}${carton.grossWeight ? ` 毛${carton.grossWeight}` : ""}` : ""}</td>
                              </tr>
                            )),
                          )}
                        </tbody>
                      </table>
                    </div>
                    {row.canWeigh
                      ? plan.cartons.map((carton) => (
                          <CartonWeightForm key={carton.id} carton={carton} />
                        ))
                      : null}
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-4 text-sm text-[var(--ink-muted)]">
                这一单还没有装箱方案。余货 {row.leftover} 件，可发 {row.packable} 件。到本页下方「余货装箱」建草稿。{" "}
                <Link href={`/orders/${row.orderId}`} className="text-[var(--brand-strong)]">
                  打开订单看色尺
                </Link>
              </p>
            )}
            {message ? <p className="mt-3 text-sm text-[var(--ink-muted)]">{message}</p> : null}
      </BoardDialog>
    </>
  );
}

function CartonWeightForm({ carton }: { carton: ProductionPackingCarton }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");

  async function submit(claimed: "estimated" | "measured", form: HTMLFormElement) {
    const data = new FormData(form);
    setPending(true);
    setMessage("");
    const response = await fetch(`/api/packing/cartons/${carton.id}/weight`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        netWeight: String(data.get("netWeight") ?? ""),
        grossWeight: String(data.get("grossWeight") ?? ""),
        claimed,
      }),
    });
    const body = (await response.json()) as { error?: string; message?: string };
    setPending(false);
    if (!response.ok) {
      setMessage(body.error || "称重失败");
      return;
    }
    setMessage(body.message || "已保存");
    router.refresh();
  }

  return (
    <form
      className="mt-3 grid gap-2 sm:grid-cols-[1fr_1fr_auto_auto] sm:items-end"
      onSubmit={(event) => {
        event.preventDefault();
        void submit("measured", event.currentTarget);
      }}
    >
      <p className="sm:col-span-4 text-xs text-[var(--ink-muted)]">
        {carton.cartonNo}：未录重量是待称重。只有净重和毛重都填才能标实测。
      </p>
      <label className="text-sm">
        <span className="mb-1 block text-xs text-[var(--ink-muted)]">净重 kg</span>
        <input
          name="netWeight"
          aria-label={`${carton.cartonNo} 净重`}
          defaultValue={carton.netWeight ?? ""}
          className="h-10 w-full rounded-lg border border-[var(--line)] bg-[var(--field-bg)] px-2"
        />
      </label>
      <label className="text-sm">
        <span className="mb-1 block text-xs text-[var(--ink-muted)]">毛重 kg</span>
        <input
          name="grossWeight"
          aria-label={`${carton.cartonNo} 毛重`}
          defaultValue={carton.grossWeight ?? ""}
          className="h-10 w-full rounded-lg border border-[var(--line)] bg-[var(--field-bg)] px-2"
        />
      </label>
      <Button
        type="button"
        size="sm"
        variant="secondary"
        disabled={pending}
        onClick={(event) => {
          const form = event.currentTarget.form;
          if (form) void submit("estimated", form);
        }}
      >
        记估算
      </Button>
      <Button type="submit" size="sm" disabled={pending}>
        记实测
      </Button>
      {message ? <p className="sm:col-span-4 text-xs text-[var(--ink-muted)]">{message}</p> : null}
    </form>
  );
}
