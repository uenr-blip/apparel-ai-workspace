"use client";
import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { computeReconDraft } from "@/server/domain/recon";
import type { FactoryReconPreview } from "@/server/services/recon";

export function FinanceReconForm({ preview }: { preview: FactoryReconPreview }) {
  const router = useRouter();
  const [price, setPrice] = useState(preview.unitPriceYuan ?? "");
  const [basis, setBasis] = useState(preview.basisNote);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const request = useRef<{ fingerprint: string; key: string } | null>(null);
  const computed = computeReconDraft({ shippedQty: preview.currentShippedQty, unitPriceYuan: price || null, basisNote: basis });
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setPending(true); setMessage("");
    const fingerprint = JSON.stringify([preview.snapshot, price, basis]);
    if (request.current?.fingerprint !== fingerprint) request.current = { fingerprint, key: crypto.randomUUID() };
    try {
      const response = await fetch(`/api/orders/${preview.orderId}/recon`, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expectedSnapshot: preview.snapshot, unitPriceYuan: price || null, basisNote: basis, idempotencyKey: request.current.key }) });
      const result = await response.json() as { error?: string; message?: string };
      if (!response.ok) throw new Error(result.error || "对账草稿保存失败");
      setMessage("对账草稿已保存，未付款。"); router.refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : "提交结果未确认，请重试核对同一凭证"); }
    finally { setPending(false); }
  }
  const field = "mt-1 w-full rounded-xl border border-[var(--line)] bg-[var(--field-solid)] p-3";
  return <form onSubmit={event => void submit(event)} className="space-y-4">
    <p className="text-sm">{preview.orderNo} · {preview.factoryName} · 当前已登记出运 <strong>{preview.currentShippedQty}</strong> 件</p>
    <label className="block text-sm">本单加工单价（人民币 / 件）<input aria-label="本单加工单价" inputMode="decimal" value={price} onChange={event => setPrice(event.target.value)} className={field} placeholder="未确认可留空" maxLength={32} /></label>
    <label className="block text-sm">核对依据<textarea aria-label="核对依据" value={basis} onChange={event => setBasis(event.target.value)} className={field} maxLength={1000} rows={3} placeholder="填写报价、约定或其他核对依据" /></label>
    <p className="rounded-xl bg-[var(--paper)] p-3 text-sm">本次草稿金额：<strong>{computed.amountYuan ?? "待核实"}</strong>{computed.amountYuan ? " 元" : ""}。按当前出运件数和本单单价核算，保存不代表付款批准。</p>
    {preview.blockedReason ? <p className="text-sm text-[var(--danger)]">{preview.blockedReason}</p> : null}
    <Button type="submit" disabled={pending || !!preview.blockedReason || (!!price && !basis.trim())}>{pending ? "保存中…" : preview.draft ? "更新对账草稿" : "生成对账草稿"}</Button>
    {message ? <p role="status" className="text-sm">{message}</p> : null}
  </form>;
}
