"use client";
import { useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Lookup } from "../finance/trade-form-parts";
import type { TradeOption } from "@/server/services/trade-lookup";
import { Button } from "@/components/ui/button";

type LotOption = { id: string; label: string; unit?: string; availableQty?: string };
type LocationOption = { id: string; label: string };
export function InventoryMoveForm({ lots, consumeLots, factories, canTransfer, canConsume, defaultMode = "transfer" }: {
  lots: LotOption[]; consumeLots: LotOption[]; factories: LocationOption[];
  canTransfer: boolean; canConsume: boolean; defaultMode?: "transfer" | "consume";
}) {
  const router = useRouter();
  const [order, setOrder] = useState<TradeOption | null>(null);
  const [mode, setMode] = useState<"transfer" | "consume">(!canTransfer && canConsume ? "consume" : defaultMode);
  const [lotId, setLotId] = useState("");
  const [qty, setQty] = useState("");
  const [toLocationId, setToLocationId] = useState(factories[0]?.id ?? "");
  const [note, setNote] = useState("");
  const [pending, setPending] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [message, setMessage] = useState("");
  const [resultLotId, setResultLotId] = useState<string | null>(null);
  const request = useRef<{ fingerprint: string; key: string } | null>(null);
  const choices = mode === "transfer" ? lots : consumeLots;
  const selected = choices.find(lot => lot.id === lotId) ?? choices[0];
  if (!canTransfer && !canConsume) return <p className="text-sm">当前账号没有办理权限，请经理在设置中下发。</p>;
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!selected) return;
    const payload = { lotId: selected.id, qty, note, ...(mode === "transfer" ? { toLocationId } : order ? { orderId: order.id } : {}) };
    const fingerprint = JSON.stringify([mode, payload]);
    if (request.current?.fingerprint !== fingerprint) request.current = { fingerprint, key: crypto.randomUUID() };
    setPending(true); setMessage("");
    try {
      const response = await fetch(`/api/inventory/${mode}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...payload, idempotencyKey: request.current.key }) });
      const body = await response.json() as { error?: string; message?: string; toLotId?: string; fromLotId?: string };
      if (!response.ok) throw new Error(body.error || "办理失败");
      setMessage(body.message || "凭证已保存"); setCompleted(true);
      setResultLotId(mode === "transfer" ? body.toLotId ?? null : body.fromLotId ?? null);
      router.refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : "提交结果尚未确认，重试会核对同一凭证"); }
    finally { setPending(false); }
  }
  const field = "mt-1 h-11 w-full rounded-xl border border-[var(--line)] bg-[var(--field-solid)] px-3 text-sm";
  return <form onSubmit={event => void submit(event)} className="space-y-4">
    <div className="flex gap-2">
      {canTransfer ? <Button type="button" size="sm" variant={mode === "transfer" ? "primary" : "secondary"} disabled={pending || completed} onClick={() => { setMode("transfer"); setLotId(""); }}>调拨到工厂</Button> : null}
      {canConsume ? <Button type="button" size="sm" variant={mode === "consume" ? "primary" : "secondary"} disabled={pending || completed} onClick={() => { setMode("consume"); setLotId(""); }}>工厂领用</Button> : null}
    </div>
    <p className="text-sm text-[var(--ink-muted)]">{mode === "transfer" ? "调拨只改变地点，公司在手合计不变。每笔保留来源批次。" : "请按工厂实际耗用登记，系统会减少这一批的在手数量。"}</p>
    <label className="block text-sm">{mode === "transfer" ? "调出批次" : "工厂批次"}
      <select aria-label={mode === "transfer" ? "调出批次" : "工厂批次"} value={selected?.id ?? ""} onChange={event => setLotId(event.target.value)} disabled={pending || completed} className={field}>
        {!choices.length ? <option value="">当前筛选没有可办理批次</option> : choices.map(lot => <option key={lot.id} value={lot.id}>{lot.label}</option>)}
      </select>
    </label>
    {mode === "transfer" ? <label className="block text-sm">调入工厂<select aria-label="调入工厂" value={toLocationId} onChange={event => setToLocationId(event.target.value)} required disabled={pending || completed} className={field}>
      <option value="">请选择工厂</option>{factories.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
    </select></label> : null}
    <label className="block text-sm">数量（{selected?.unit ?? "按批次单位"}）<input aria-label="办理数量" type="number" min="0.001" max="2147483647" step="0.001" required value={qty} onChange={event => setQty(event.target.value)} disabled={pending || completed} className={field} /></label>
    <p className="text-xs text-[var(--ink-muted)]">可办理 {selected?.availableQty ?? "—"} {selected?.unit}。最多3位小数，不自动换算单位。</p>
    {mode === "consume" && !completed ? <Lookup label="实际耗用订单（可暂留待归单）" kind="orders" endpoint="/api/material-ledger/lookup" selected={order} onSelect={setOrder} /> : null}
    <label className="block text-sm">备注<input aria-label="办理备注" value={note} onChange={event => setNote(event.target.value)} maxLength={200} disabled={pending || completed} className={field} /></label>
    <Button type="submit" disabled={pending || completed || !selected || !qty || (mode === "transfer" && !toLocationId)}>{pending ? "办理中…" : mode === "transfer" ? "确认调拨" : "确认领用"}</Button>
    {message ? <p role="status" className="text-sm">{message}</p> : null}
    {resultLotId ? <Link href={`/resources/lots/${resultLotId}`} className="block text-sm text-[var(--brand-strong)]">{mode === "transfer" ? "查看调入批次与凭证" : "查看本批次与凭证"}</Link> : null}
    {completed ? <Button type="button" variant="secondary" onClick={() => { setCompleted(false); setQty(""); setMessage(""); setResultLotId(null); request.current = null; }}>登记下一笔</Button> : null}
  </form>;
}
