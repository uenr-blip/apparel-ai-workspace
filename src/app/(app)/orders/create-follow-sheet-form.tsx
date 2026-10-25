"use client";

import { useEffect, useId, useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { FollowSuggestion } from "@/lib/follow-assistant";
import { Button } from "@/components/ui/button";

const fieldClass =
  "mt-1 w-full rounded-md border border-[var(--line)] bg-[var(--field-solid)] px-3 py-2 text-sm";

export function CreateFollowSheetForm({ suggestion, assistantTicket, sourceStyle }: { suggestion?: FollowSuggestion; assistantTicket?: string; sourceStyle?: { id: string; code: string; name: string; seasonCode: string } } = {}) {
  const router = useRouter();
  const fieldId = useId();
  const idempotencyKey = useMemo(() => crypto.randomUUID(), []);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [kind, setKind] = useState(suggestion?.kind ?? "bulk");
  const [title, setTitle] = useState(suggestion?.title ?? (sourceStyle ? `${sourceStyle.code} 跟单` : ""));
  const [seasonCode, setSeasonCode] = useState(suggestion?.seasonCode ?? sourceStyle?.seasonCode ?? "");
  const [factoryName, setFactoryName] = useState(suggestion?.factoryName ?? "");

  const [choices, setChoices] = useState<{ customers: Array<{id:string;name:string}>; factories: Array<{id:string;name:string}> }>({customers:[],factories:[]});
  const [customerId,setCustomerId] = useState("");
  useEffect(() => { let live=true; void fetch("/api/orders/follow/choices").then(r=>r.ok?r.json():Promise.reject(new Error("客户与工厂名单加载失败"))).then(d=>{if(live)setChoices(d);}).catch(()=>{if(live)setError("客户与工厂名单未加载，请刷新后重试");}); return ()=>{live=false;}; },[]);
  const [sourcePo, setSourcePo] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const fields = [
    ...(sourceStyle ? [{ key: "po", label: "订单 PO", control: <input id={`${fieldId}-po`} className={fieldClass} value={sourcePo} maxLength={80} placeholder="填写本次客户 PO，可先留空" onChange={event => setSourcePo(event.target.value)} /> }] : []),
    { key: "kind", label: "这张是", control: <select id={`${fieldId}-kind`} className={fieldClass} value={kind} onChange={event => setKind(event.target.value === "sales_sample" ? "sales_sample" : "bulk")}><option value="sales_sample">销售样</option><option value="bulk">大货</option></select> },
    { key: "customer", label: "客户", control: <select id={`${fieldId}-customer`} className={fieldClass} value={customerId} onChange={e=>setCustomerId(e.target.value)}><option value="">待确认，可先补草稿</option>{choices.customers.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select> },
    { key: "title", label: "跟单名称", control: <input id={`${fieldId}-title`} className={fieldClass} value={title} maxLength={80} placeholder="例如 SS27 女装大货" onChange={event => setTitle(event.target.value)} /> },
    { key: "season", label: "季节", control: <input id={`${fieldId}-season`} className={fieldClass} value={seasonCode} maxLength={40} placeholder="例如 SS27，可以先空着" onChange={event => setSeasonCode(event.target.value)} /> },
    ...(kind === "bulk" ? [{ key: "factory", label: "工厂", control: <select id={`${fieldId}-factory`} required className={fieldClass} value={factoryName} onChange={event=>setFactoryName(event.target.value)}><option value="">选择已建档工厂</option>{factoryName && !choices.factories.some(f=>f.name===factoryName)?<option value={factoryName}>{factoryName}（待建档核对）</option>:null}{choices.factories.map(f=><option key={f.id} value={f.name}>{f.name}</option>)}</select> }] : []),
  ];

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    try {
    const response = await fetch("/api/orders/follow", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...(sourceStyle ? { sourceStyleId: sourceStyle.id, sourcePo } : {}), ...(customerId ? { customerId } : {}), ...(kind === "bulk" && choices.factories.find(f=>f.name===factoryName) ? {factoryId:choices.factories.find(f=>f.name===factoryName)!.id}:{}), kind, title, seasonCode, factoryName: kind === "bulk" ? factoryName : "", idempotencyKey, ...(assistantTicket ? { assistantTicket, confirmed } : {}) }),
    });
    const body = (await response.json()) as { error?: string; sheetId?: string };
    setPending(false);
    if (!response.ok || !body.sheetId) {
      setError(body.error || "跟单没有建成");
      return;
    }
    router.push(`/orders/follow/${body.sheetId}`);
    router.refresh();
    } catch { setError("连接中断，请核对是否已建成，再用原请求重试"); } finally { setPending(false); }
  }

  return (
    <form className="space-y-4" onSubmit={submit} onChange={() => setConfirmed(false)}><fieldset disabled={pending} className="space-y-4">
      {sourceStyle ? <p className="text-sm font-medium">{sourceStyle.code} · {sourceStyle.name}</p> : null}
      {suggestion ? <div className="overflow-x-auto rounded-xl border border-[var(--line)]"><table className="w-full text-left text-sm">
        <caption className="px-3 py-3 text-left font-medium">跟单草稿 · 尚未保存</caption>
        <thead><tr><th scope="col" className="border-b border-[var(--line)] p-3">项目</th><th scope="col" className="border-b border-[var(--line)] p-3">草稿内容（可修改）</th></tr></thead>
        <tbody>{fields.map(field => <tr key={field.key}><th scope="row" className="w-24 whitespace-nowrap border-b border-[var(--line)] p-3 font-normal"><label htmlFor={`${fieldId}-${field.key}`}>{field.label}</label></th><td className="border-b border-[var(--line)] p-3">{field.control}</td></tr>)}</tbody>
      </table></div> : fields.map(field => <div key={field.key} className="text-sm"><label htmlFor={`${fieldId}-${field.key}`}>{field.label}</label>{field.control}</div>)}
      <p className="text-xs leading-6 text-[var(--ink-muted)]">
        {sourceStyle ? "保存后进入这款的跟单草稿，继续填写颜色、数量和交期。历史 PO 保留，不会自动开生产订单。" : "建成后在这一张单里加很多款。这不是口头建的生产订单，也不会采购。"}
      </p>
      <a className="text-xs underline" href="/resources/catalog?kind=factory" target="_blank" rel="noreferrer">缺少客户或工厂？打开资料维护建档，完成后刷新此页</a>
      {error ? <p className="text-sm text-[var(--danger)]">{error}</p> : null}
      </fieldset>
      {assistantTicket ? <label className="flex gap-2 text-sm"><input type="checkbox" checked={confirmed} disabled={pending} onChange={e => { e.stopPropagation(); setConfirmed(e.target.checked); }} />我已核对或修改表头，确认只建跟单表，随后在表中补款式和件数。</label> : null}
      <Button type="submit" disabled={pending || Boolean(assistantTicket && !confirmed)}>
        {pending ? "正在建…" : sourceStyle ? "保存 PO，继续补跟单" : "建成这张跟单"}
      </Button>
    </form>
  );
}
