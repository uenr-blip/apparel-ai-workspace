"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { FactoryTransferRecords } from "@/components/factory-transfer-records";
import type { getFactoryTransferBoard } from "@/server/services/factory-transfer";
type Board = Awaited<ReturnType<typeof getFactoryTransferBoard>>;
export function TransferForm({ board, manager }: { board: Board; manager: boolean }) {
  const router = useRouter();
  const [stage, setStage] = useState<"unstarted" | "cut" | "sewn">("unstarted");
  const [processNote, setProcessNote] = useState("");
  const available = (r: Board["rows"][number]) => stage === "unstarted" ? r.available : r.wipAvailable;
  const [values, setValues] = useState<Record<string, string>>({});
  const [target, setTarget] = useState(""); const [reason, setReason] = useState(""); const [reference, setReference] = useState("");
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [key, setKey] = useState(() => crypto.randomUUID()); const [busy, setBusy] = useState(false); const [message, setMessage] = useState("");
  async function send(url: string, body: unknown) {
    setBusy(true); setMessage(""); try { const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); const data = await res.json(); if (!res.ok) throw new Error(data.error || "未保存"); setMessage("已保存，请核对下方记录与下一步。"); setKey(crypto.randomUUID()); setValues({}); router.refresh(); } catch (e) { setMessage(e instanceof Error ? e.message : "连接中断，请核对后重试"); } finally { setBusy(false); }
  }
  const waiting = board.records.filter(r => ["requested", "reviewed"].includes(r.status));
  return <div className="space-y-5">
    <p className="text-sm">先登记 → 负责人核对影响 → 主管确认 → 新厂接单并核对投产。客户 PO 保持不变，原厂已发生的生产、采购和费用记录保留。</p>
    <p className="text-sm text-[var(--ink-muted)]">选择交接形态后，可整批或逐色逐码转出。布料通过库存调拨另记；裁片和车缝半成品接收时核对实物、工序与后续用料，计作接续，不再登记一次投产。</p>
    {!waiting.length ? <form className="space-y-3" onSubmit={e => { e.preventDefault(); void send(`/api/orders/${board.order.id}/transfers`, { stage, processNote, toFactoryId: target, reason, sourceReference: reference, stamp: board.stamp, idempotencyKey: key, selections: board.rows.filter(r => Number(values[r.sizeId]) > 0).map(r => ({ sizeId: r.sizeId, quantity: Number(values[r.sizeId]) })) }); }}>
      <label className="block">交接形态<select className="mt-1 w-full rounded-lg border border-[var(--line)] bg-[var(--paper)] p-2" value={stage} onChange={e => { setStage(e.target.value as typeof stage); setValues({}); setKey(crypto.randomUUID()); }}><option value="unstarted">未开工任务 / 未加工布料</option><option value="cut">已裁裁片</option><option value="sewn">已车缝半成品</option></select></label>
      {stage !== "unstarted" ? <label className="block">工序交接<textarea className="mt-1 w-full rounded-lg border border-[var(--line)] bg-[var(--paper)] p-2" required maxLength={4000} placeholder="例如：裁片已裁齐未车缝；新厂从车缝开始；附裁片捆号及待处理问题" value={processNote} onChange={e => { setProcessNote(e.target.value); setKey(crypto.randomUUID()); }} /></label> : null}
      <label className="block">接收工厂<select className="rounded-lg border border-[var(--line)] bg-[var(--paper)] px-3 py-2 text-[var(--ink)] mt-1 w-full" required value={target} onChange={e => { setTarget(e.target.value); setKey(crypto.randomUUID()); }}><option value="">请选择另一家工厂</option>{board.factories.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}</select></label>
      <Button type="button" variant="outline" disabled={busy} onClick={() => { setValues(Object.fromEntries(board.rows.filter(r => available(r)).map(r => [r.sizeId, String(available(r))]))); setKey(crypto.randomUUID()); }}>填入本形态全部可转数量</Button>
      <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr><th>款式 / 颜色 / 尺码</th><th>计划</th><th>已开工</th><th>可转</th><th>本次转出</th></tr></thead><tbody>{board.rows.map(r => <tr key={r.sizeId} className="border-t border-[var(--line)]"><td className="py-2">{r.styleCode} · {r.colorName} / {r.sizeCode}{r.reason ? <p className="text-[var(--warning)]">{r.reason}</p> : null}</td><td>{r.ordered}</td><td>{r.started}</td><td>{available(r)}</td><td><input className="rounded-lg border border-[var(--line)] bg-[var(--paper)] px-3 py-2 text-[var(--ink)] w-24" aria-label={`${r.styleCode} ${r.colorName} ${r.sizeCode} 转出件数`} type="number" min="0" max={available(r)} disabled={busy || !available(r)} value={values[r.sizeId] ?? ""} onChange={e => { setValues(v => ({ ...v, [r.sizeId]: e.target.value })); setKey(crypto.randomUUID()); }} /></td></tr>)}</tbody></table></div>
      <label className="block">转厂原因<textarea className="rounded-lg border border-[var(--line)] bg-[var(--paper)] px-3 py-2 text-[var(--ink)] mt-1 w-full" required maxLength={2000} value={reason} onChange={e => { setReason(e.target.value); setKey(crypto.randomUUID()); }} /></label>
      <label className="block">依据（客户要求、交接单号或沟通记录）<input className="rounded-lg border border-[var(--line)] bg-[var(--paper)] px-3 py-2 text-[var(--ink)] mt-1 w-full" required maxLength={2000} value={reference} onChange={e => { setReference(e.target.value); setKey(crypto.randomUUID()); }} /></label>
      <Button disabled={busy || !board.rows.some(r => Number(values[r.sizeId]) > 0)}>{busy ? "正在保存…" : "登记转厂，交负责人核对"}</Button>
    </form> : null}
    <p className="text-sm">原单涉及采购 {board.impact.purchases} 条、占料 {board.impact.allocations} 条、未出运装箱 {board.impact.packing} 张。转厂不会自动改采购、调拨、付款或交期。</p>
    {waiting.map(r => <div key={r.id} className="space-y-2 rounded-lg border border-[var(--line)] p-3"><p>{r.from} → {r.to} · {r.status === "requested" ? "待负责人核对" : "待主管确认"}</p><label className="block text-sm">核对说明（材料去向、原厂费用、交期和新厂接收安排）<textarea className="rounded-lg border border-[var(--line)] bg-[var(--paper)] px-3 py-2 text-[var(--ink)] mt-1 w-full" value={notes[r.id] ?? ""} maxLength={4000} onChange={e => setNotes(n => ({ ...n, [r.id]: e.target.value }))} /></label><div className="flex flex-wrap gap-2">{r.status === "requested" || manager ? <Button disabled={busy || !notes[r.id]?.trim()} onClick={() => void send(`/api/factory-transfers/${r.id}`, { action: r.status === "requested" ? "review" : "approve", note: notes[r.id] })}>{r.status === "requested" ? "已核对影响，交主管确认" : "确认转厂并生成接收生产单"}</Button> : <p>等待主管确认。</p>}<Button variant="outline" disabled={busy || !notes[r.id]?.trim()} onClick={() => void send(`/api/factory-transfers/${r.id}`, { action: "reject", note: notes[r.id] })}>退回，保留记录</Button></div></div>)}
    {message ? <p role="status" className="text-sm">{message}</p> : null}
    <FactoryTransferRecords records={board.records} />
  </div>;
}
