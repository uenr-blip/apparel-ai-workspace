"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useFollowEditState } from "./follow-edit-state";
import { Button } from "@/components/ui/button";
import { FilterSelect } from "@/components/fill-pack";

type Row = { id: string; label: string; po: string; shipDate?: string; quantity: number; registered: boolean; order: { id: string; orderNo: string } | null };
export function OpenFollowOrder({ sheetId, expectedUpdatedAt, customers, initialCustomerId = "", rows = [], order }: {
  sheetId: string; expectedUpdatedAt: string; initialCustomerId?: string; customers: Array<{ id: string; label: string }>; rows?: Row[]; order: { id: string; orderNo: string } | null;
}) {
  const router = useRouter();
  const editing = useFollowEditState();
  const [key, setKey] = useState(() => crypto.randomUUID());
  const [customerId, setCustomerId] = useState(initialCustomerId);
  const [selected, setSelected] = useState<string[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ orderId: string; orderNo: string; skipped: string[] } | null>(null);
  const remaining = rows.filter(r => !r.order);
  const eligible = remaining.filter(r => r.registered && r.quantity > 0);
  const groups = [...new Set(eligible.map(r => JSON.stringify([r.po.trim().toUpperCase(), r.shipDate || ""])))].map(key => ({ key, rows: eligible.filter(r => JSON.stringify([r.po.trim().toUpperCase(), r.shipDate || ""]) === key) }));
  const selectedDates = new Set(rows.filter(r => selected.includes(r.id)).map(r => r.shipDate).filter(Boolean));
  const basis = JSON.stringify({ expectedUpdatedAt, customerId, selected, dirty: !!editing?.dirty, stageEditing: !!editing?.stageEditing, refreshing: !!editing?.refreshing });
  const [observedBasis, setObservedBasis] = useState(basis);
  const [confirmed, setConfirmed] = useState(false);
  if (observedBasis !== basis) { setObservedBasis(basis); setConfirmed(false); }
  const selectedPos = new Set(rows.filter(r => selected.includes(r.id)).map(r => r.po.trim().toUpperCase()));
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (editing?.dirty || editing?.stageEditing || editing?.refreshing) { setError("请先保存或取消用料、交接和跟单的修改，再核对开单。"); return; }
    if (!confirmed || !selected.length || selectedPos.size > 1 || selectedDates.size > 1) { setError("请先核对所选款式、PO 和交期，并确认开单范围。"); return; }
    setPending(true); setError("");
    try {
      const response = await fetch(`/api/orders/follow/${sheetId}/open`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ customerId, idempotencyKey: key, expectedUpdatedAt, rowIds: selected }) });
      const body = await response.json();
      if (!response.ok || !body.orderId) { setError(body.error || "没有开成生产订单"); return; }
      setResult(body); setSelected([]); setKey(crypto.randomUUID()); router.refresh();
    } catch { setError("连接中断，请重试并核对结果；重复提交不会重复建单。"); }
    finally { setPending(false); }
  }
  return <form className="space-y-3" onSubmit={submit}>
    <h2 className="font-medium">核对并开成生产订单</h2>
    <p className="text-sm text-[var(--ink-muted)]">同一 PO、同一交期的多款可以整表选中，也可以只选部分款。先保存资料，再核对本次开单范围。未建档或件数未齐的款留在此处补齐；已转出的不会再开一次。这里只创建生产订单；资料批准、分色确认、料况核对和批准投产仍在生产订单内办理。</p>
    {order ? <p className="text-sm">首张生产单：<Link className="underline" href={`/orders/${order.id}`}>{order.orderNo}</Link>。以每款下面的状态为准。</p> : null}
    {eligible.length ? <div className="flex flex-wrap gap-3 text-sm">
      {groups.map(group => <button key={group.key} type="button" disabled={pending} className="rounded border border-[var(--line)] px-3 py-2 text-[var(--brand-strong)]" onClick={() => { setSelected(group.rows.map(r => r.id)); setKey(crypto.randomUUID()); }}>{groups.length === 1 && eligible.length === remaining.length ? `${remaining.length === rows.length ? "选择整表" : "选择全部剩余款"}（${group.rows.length} 款）` : `选择 ${group.rows[0].po || "尚无 PO"} · ${group.rows[0].shipDate || "交期待补"}（${group.rows.length} 款）`}</button>)}
      {selected.length ? <button type="button" disabled={pending} onClick={() => { setSelected([]); setKey(crypto.randomUUID()); }}>取消选择</button> : null}
    </div> : null}
    {groups.length > 1 ? <p className="text-sm text-[var(--ink-muted)]">本表有不同 PO 或交期，已分组供选择；每次核对一组，开单后继续处理其他组。</p> : null}
    <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr><th>选择</th><th>款式</th><th>客户 PO</th><th>要求出货日期</th><th>可计入件数</th><th>下一步</th></tr></thead><tbody>{rows.map(r => <tr key={r.id} className="border-t border-[var(--line)]"><td className="py-2">{!r.order ? <input type="checkbox" aria-label={`选择 ${r.label} ${r.po}`} checked={selected.includes(r.id)} disabled={pending || !!editing?.refreshing || !r.registered || !r.quantity} onChange={e => { setSelected(s => e.target.checked ? [...s, r.id] : s.filter(id => id !== r.id)); setKey(crypto.randomUUID()); }} /> : "已转"}</td><td>{r.label}</td><td>{r.po || "尚无 PO"}</td><td>{r.shipDate || "待补"}</td><td>{r.quantity || "待补"}</td><td>{r.order ? <Link className="underline" href={`/orders/${r.order.id}`}>{r.order.orderNo} · 进入生产单</Link> : !r.registered ? "先建款式主档" : !r.quantity ? "补齐颜色与件数" : "可选中开单"}</td></tr>)}</tbody></table></div>
    {remaining.length ? <><FilterSelect name="customerId" label="客户" emptyLabel="请选择并核对客户" value={customerId} options={customers} required onChange={id => { setCustomerId(id); setKey(crypto.randomUUID()); }} />
    {selectedPos.size > 1 ? <p role="alert">所选含不同 PO，请每次勾选同一 PO；其余款可以随后接续开单。</p> : null}
    {editing?.refreshing ? <p role="status">已保存，正在回查最新款式与数量，请稍候再确认开单。</p> : null}
    {selectedDates.size > 1 ? <p role="alert">所选交期不同，请分组开单。</p> : null}
    {editing?.dirty || editing?.stageEditing ? <p role="status">有尚未保存的跟单、用料或交接修改，请先保存或取消，再核对开单。</p> : null}
    <label className="flex items-start gap-2 text-sm"><input aria-label="确认本次开单范围" type="checkbox" checked={confirmed} disabled={pending || !!editing?.refreshing || !selected.length || !!editing?.dirty || !!editing?.stageEditing || selectedPos.size > 1 || selectedDates.size > 1} onChange={e => setConfirmed(e.target.checked)} />已核对所选款式、客户 PO、颜色件数与交期，确认创建生产订单；这不代表批准投产。</label>
    <Button type="submit" disabled={pending || !customerId || !selected.length || selectedPos.size > 1 || selectedDates.size > 1 || !confirmed || editing?.dirty || editing?.stageEditing || editing?.refreshing}>{pending ? "正在开单…" : `将所选 ${selected.length} 款开成生产订单`}</Button></> : <p>{rows.length ? "本表各款已转生产，可从对应链接继续处理。" : "请先保存跟单款式，再核对开单。"}</p>}
    {error ? <p role="alert" className="text-sm text-[var(--danger)]">{error}</p> : null}
    {result ? <div role="status" className="text-sm"><Link className="underline" href={`/orders/${result.orderId}`}>已开 {result.orderNo}，进入生产订单</Link>{result.skipped?.length ? <p>仍留在跟单待补：{result.skipped.join("；")}</p> : null}</div> : null}
  </form>;
}
