"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { IntakeDraft, emptyIntakeItem, intakeMissing, intakeWarnings, type IntakeDraftValue, type IntakeCatalog } from "@/lib/customer-intake";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
const field = "w-full rounded-md border border-[var(--line)] bg-[var(--field-solid)] px-2 py-2 text-sm";
export function IntakeReviewForm(props: { sourceId: string; initial: IntakeDraftValue; jobId: string | null; proposalId: string | null; revision: string | null; catalog: IntakeCatalog; modelReady: boolean; error: string | null; warnings: string[]; calledLiveModel: boolean; duplicates?: Array<{ sheetId: string; title: string }> }) {
  const router = useRouter();
  const [draft, setDraft] = useState(props.initial), [proposal, setProposal] = useState(props.proposalId), [revision, setRevision] = useState(props.revision), [job, setJob] = useState(props.jobId);
  const [dirty, setDirty] = useState(false), [confirmed, setConfirmed] = useState(false), [pending, setPending] = useState(false), [message, setMessage] = useState("");
  const [duplicates, setDuplicates] = useState(props.duplicates ?? []);
  const missing = intakeMissing(draft), warnings = intakeWarnings(draft);
  function change(next: IntakeDraftValue) { setDraft(next); setDirty(true); setConfirmed(false); setMessage(""); }
  function header(key: keyof Omit<IntakeDraftValue, "items">, value: string) { change({ ...draft, [key]: value }); }
  function item(index: number, patch: Partial<IntakeDraftValue["items"][number]>) { change({ ...draft, items: draft.items.map((row, i) => i === index ? { ...row, ...patch } : row) }); }
  async function request(body: object) {
    const res = await fetch(`/api/inbox/${props.sourceId}/workflow`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const result = await res.json(); if (!res.ok) throw new Error(result.error || "操作未完成"); return result;
  }
  async function save() {
    setPending(true); setMessage(""); setConfirmed(false);
    try {
      const parsed = IntakeDraft.safeParse(draft); if (!parsed.success) throw new Error("请检查日期、文字长度和颜色行，日期要有完整年份");
      const result = await request({ operation: "save", jobId: job, expectedProposalId: proposal, draft: parsed.data });
      setDuplicates(result.duplicates ?? []); setProposal(result.proposalId); setRevision(result.revision); setJob(result.jobId); setDirty(false); setMessage("核对草稿已保存。请确认下方待补项，再建成跟单。");
    } catch (e) { setMessage(e instanceof Error ? e.message : "连接中断，请刷新核对草稿是否保存"); }
    finally { setPending(false); }
  }
  async function execute() {
    if (dirty || !confirmed || !proposal || !revision) return;
    setPending(true); setMessage("");
    try { const result = await request({ operation: "confirm", proposalId: proposal, revision, confirmed }); router.push(`/orders/follow/${result.sheetId}`); router.refresh(); }
    catch (e) { setMessage(e instanceof Error ? e.message : "连接中断，可用本次确认重试，不会重复建单"); }
    finally { setPending(false); }
  }
  async function prepare() {
    setPending(true); setMessage(""); setConfirmed(false);
    try { await request({ operation: "prepare", useModel: true }); router.refresh(); }
    catch (e) { setMessage(e instanceof Error ? e.message : "整理失败，可手动填写"); }
    finally { setPending(false); }
  }
  return <Card className="p-4 space-y-4">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="font-medium">待核对表格 · {dirty ? "有未保存修改" : proposal ? "已保存，尚未建成跟单" : "尚未保存"}</h2><p className="mt-1 text-xs text-[var(--ink-muted)]">{props.calledLiveModel ? "模型已整理原文，请逐项核对；匹配不代表客户已批准。" : "可直接手动填写，也可使用已配置模型整理原文。"}</p></div>
      <Button variant="secondary" disabled={pending || dirty || !props.modelReady} onClick={() => void prepare()}>{pending ? "处理中…" : "重新智能整理"}</Button>
    </div>
    {props.error ? <p role="alert" className="rounded-lg bg-[var(--paper)] p-3 text-sm text-[var(--warning)]">{props.error}。原件已保留，下方可以继续人工填写。</p> : null}
    <p className="text-xs text-[var(--ink-muted)]">本次只接大货，同一客户、工厂、PO。一份资料含多 PO 或多工厂时请先拆分；销售样、改旧单暂回原流程处理。重新智能整理会发送原文至配置模型并计费，已有核对版本留在记录中。</p>
    <fieldset disabled={pending} className="space-y-4">
      <div className="grid gap-3 md:grid-cols-3">
        <label className="text-sm">跟单名称<input className={field} value={draft.title} maxLength={80} onChange={e => header("title", e.target.value)} /></label>
        <label className="text-sm">客户<select aria-label="客户" className={field} value={draft.customerId} onChange={e => header("customerId", e.target.value)}><option value="">请选择客户</option>{props.catalog.customers.map(c => <option key={c.id} value={c.id}>{c.name} · {c.code}</option>)}</select></label>
        <label className="text-sm">负责工厂<select aria-label="负责工厂" className={field} value={draft.factoryId} onChange={e => header("factoryId", e.target.value)}><option value="">请选择工厂</option>{props.catalog.factories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        {([ ["po", "客户 PO"], ["seasonCode", "季节"], ["purchaseDate", "客户采购日期"], ["shipDate", "要求出货日期"], ["inboundDate", "进仓日期"] ] as const).map(([key, label]) => <label key={key} className="text-sm">{label}<input type={key.endsWith("Date") ? "date" : "text"} className={field} value={draft[key]} onChange={e => header(key, e.target.value)} /></label>)}
      </div>
      <label className="block text-sm">本次客户要求<textarea rows={2} className={field} value={draft.note} onChange={e => header("note", e.target.value)} placeholder="例如更换袖口、配件或包装；这是要求，不代表已批准。" /></label>
      {draft.items.map((row, index) => <section key={index} className="rounded-xl border border-[var(--line)] p-3 space-y-3">
        <div className="flex justify-between"><h3 className="text-sm">第 {index + 1} 款</h3>{draft.items.length > 1 ? <Button size="sm" variant="ghost" onClick={() => change({ ...draft, items: draft.items.filter((_, i) => i !== index) })}>移除此款</Button> : null}</div>
        <div className="grid gap-3 md:grid-cols-3">
          <StyleChoice label={`第 ${index + 1} 款关联款式`} rows={props.catalog.styles} value={row.styleId} onChange={styleId => { const match = props.catalog.styles.find(s => s.id === styleId); item(index, { styleId, styleName: row.styleName || match?.name || "" }); }} />
          <label className="text-sm">产品编号<input className={field} value={row.productCode} onChange={e => item(index, { productCode: e.target.value })} placeholder="跨 PO 不变的产品身份证" /></label>
          <label className="text-sm">品名<input className={field} value={row.styleName} onChange={e => item(index, { styleName: e.target.value })} /></label>
          <label className="text-sm">类别<select className={field} value={row.craftFamily} onChange={e => item(index, { craftFamily: e.target.value as typeof row.craftFamily })}><option value="">待确认</option><option value="sweater">毛衣</option><option value="knit">针织</option><option value="woven">梭织</option></select></label>
          <label className="text-sm">面料成分<input className={field} value={row.composition} onChange={e => item(index, { composition: e.target.value })} /></label>
          <label className="text-sm">本款要求<input className={field} value={row.note} onChange={e => item(index, { note: e.target.value })} /></label>
        </div>
        {!row.styleId ? <p className="text-xs text-[var(--warning)]">未关联款式也可暂存在跟单上，之后补建档再开生产订单，不自动新建主款。</p> : null}
        <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr><th className="p-2">客户颜色</th><th className="p-2">本批件数</th><th className="w-16 p-2">操作</th></tr></thead><tbody>{row.colors.map((color, ci) => <tr key={ci}><td className="p-1"><input aria-label={`第${index + 1}款颜色${ci + 1}`} className={field} value={color.name} onChange={e => item(index, { colors: row.colors.map((c, i) => i === ci ? { ...c, name: e.target.value } : c) })} /></td><td className="p-1"><input aria-label={`第${index + 1}款件数${ci + 1}`} className={field} value={color.quantity} placeholder="整数，或不下" onChange={e => item(index, { colors: row.colors.map((c, i) => i === ci ? { ...c, quantity: e.target.value } : c) })} /></td><td className="p-1"><button type="button" onClick={() => item(index, { colors: row.colors.filter((_, i) => i !== ci) })}>移除</button></td></tr>)}</tbody></table></div>
        <Button size="sm" variant="secondary" disabled={row.colors.length >= 40} onClick={() => item(index, { colors: [...row.colors, { name: "", quantity: "" }] })}>添加颜色</Button>
      </section>)}
      <Button variant="secondary" disabled={draft.items.length >= 20} onClick={() => change({ ...draft, items: [...draft.items, emptyIntakeItem()] })}>添加同一 PO 的款</Button>
    </fieldset>
    <div className="rounded-lg bg-[var(--paper)] p-3 text-sm space-y-2">
      {missing.length ? <p>建跟单前需补齐：{missing.join("、")}</p> : <p>必填项已齐，可以保存核对草稿。</p>}
      {warnings.length ? <p className="text-[var(--warning)]">可留待跟单补齐：{warnings.join("；")}</p> : null}
      {props.warnings.length ? <p>原文待核对：{props.warnings.join("；")}</p> : null}
    </div>
    {duplicates.length ? <div role="alert" className="rounded-lg border border-[var(--warning)] p-3 text-sm">已找到该工厂相同 PO 的跟单，请先核对，避免重复建单：{duplicates.map(d => <Link className="ml-3 text-[var(--brand-strong)] underline" key={d.sheetId} href={`/orders/follow/${d.sheetId}`}>{d.title}</Link>)}</div> : null}
    <div className="flex flex-wrap gap-3"><Button variant="secondary" disabled={pending} onClick={() => void save()}>保存核对草稿</Button><Button disabled={pending || dirty || !proposal || !confirmed || missing.length > 0 || duplicates.length > 0} onClick={() => void execute()}>{pending ? "处理中…" : "确认，建成大货跟单"}</Button></div>
    <label className="flex gap-2 text-sm"><input type="checkbox" checked={confirmed} disabled={pending || dirty || !proposal || missing.length > 0 || duplicates.length > 0} onChange={e => setConfirmed(e.target.checked)} />我已核对客户、PO、产品、颜色数量与待补项；确认本次只建一张大货跟单。</label>
    <p className="text-xs text-[var(--ink-muted)]">修改任何内容后需要重新保存、确认。保存跟单不采购、不通知工厂、不批准投产。</p>
    {message ? <p role="status" className="text-sm text-[var(--brand-strong)]">{message}</p> : null}
  </Card>;
}
function StyleChoice({ rows, value, onChange, label }: { rows: IntakeCatalog["styles"]; value: string; onChange: (id: string) => void; label: string }) {
  const [query, setQuery] = useState(""); const selected = rows.find(r => r.id === value);
  const found = rows.filter(r => `${r.code} ${r.name} ${(r.productCodes ?? []).join(" ")}`.toLowerCase().includes(query.trim().toLowerCase())).slice(0, 30);
  return <div className="text-sm"><label>{label}<input aria-label={`${label}搜索`} className={field} value={query} onChange={e => setQuery(e.target.value)} placeholder="输入产品编号、款号或品名" /></label><select aria-label={label} className={`${field} mt-1`} value={value} onChange={e => onChange(e.target.value)}><option value="">暂未关联，先保留资料</option>{selected && !found.some(r => r.id === value) ? <option value={value}>{selected.code} · {selected.name}</option> : null}{found.map(r => <option key={r.id} value={r.id}>{r.code} · {r.name}{r.productCodes?.length ? ` · ${r.productCodes.join(" / ")}` : ""}</option>)}</select><span className="text-xs text-[var(--ink-muted)]">输入一个字或部分款号即可筛选，最多显示 30 项。</span></div>;
}
