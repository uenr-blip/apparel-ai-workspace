"use client";
import Link from "next/link";
import { StageMaterialPicker } from "./stage-material-picker";
import { useState, useEffect, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { StyleConstructionFields, StyleConstructionSummary } from "@/app/(app)/styles/style-construction-fields";
import { STAGE_LABELS, type StageTransferInput } from "@/lib/workflow-stage";
import { useFollowEditState } from "@/app/(app)/orders/follow-edit-state";
import type { StageWorkspace, previewStageTransfer } from "@/server/services/workflow-stage";

const field = "mt-1 block w-full rounded-lg border border-[var(--line)] bg-[var(--surface)] p-2 text-sm";
export function WorkflowStagePanel({ board, initialRevisionId }: { board: StageWorkspace; initialRevisionId?: string }) {
  const router = useRouter();
  const [picking, setPicking] = useState(false);
  const otherForm = useFollowEditState();
  const [editing, setEditing] = useState(false), [transferring, setTransferring] = useState(false), [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const [preview, setPreview] = useState<Awaited<ReturnType<typeof previewStageTransfer>> | null>(null), [confirmed, setConfirmed] = useState(false);
  const [requestKey, setRequestKey] = useState(() => crypto.randomUUID()), [revisionId, setRevisionId] = useState(initialRevisionId ?? board.revisionId ?? "");
  const [draft, setDraft] = useState<StageTransferInput>({ target: board.target, title: `${board.label} · ${board.kind === "development" ? "销售样" : "大货"}`.slice(0, 80), batchKey: "", customerId: board.customerId, ownerId: board.ownerId, seasonCode: board.seasonCode, basis: "", factoryId: "", patternRevisionId: "" });
  const [editStamp, setEditStamp] = useState(board.stamp);
  const nextLabel = board.kind === "development" ? "销售样" : "大货";
  const selected = board.history.find(r => r.id === revisionId) ?? board.history[0];
  const historical = Boolean(selected && selected.id !== board.revisionId);
  const imageBase = (id?: string | null) => board.stageId && id ? `/api/workflow/stages/${board.stageId}/images/${id}` : board.seedImageBaseUrl;
  async function jsonCall(body: unknown) {
    if (otherForm?.dirty || otherForm?.refreshing) throw new Error("请先保存跟单表的改动，再处理用料或交接");
    const response = await fetch("/api/workflow/stages", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const result = await response.json(); if (!response.ok) throw new Error(result.error || "操作失败，请刷新核对"); return result;
  }
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); if (otherForm?.dirty || otherForm?.refreshing) { setMessage("请先保存跟单表的改动，再保存用料"); return; } const form = new FormData(e.currentTarget); form.set("target", JSON.stringify(board.target)); form.set("expectedStamp", editStamp); form.set("requestKey", requestKey); setBusy(true); setMessage("");
    try { const response = await fetch("/api/workflow/stages/materials", { method: "POST", body: form }); const result = await response.json(); if (!response.ok) throw new Error(result.error || "保存失败"); setMessage(result.message); setEditing(false); setRequestKey(crypto.randomUUID()); setRevisionId(""); router.refresh(); } catch(e) { setMessage(e instanceof Error ? e.message : "连接中断，填写内容保留"); } finally { setBusy(false); }
  }
  async function transfer(final: boolean) {
    setBusy(true); setMessage("");
    try { const result = await jsonCall({ action: final ? "confirm" : "preview", input: draft, expectedStamp: preview?.stamp, requestKey, confirmed });
      if (final) { router.push(`/orders/follow/${result.sheetId}#follow-product`); router.refresh(); } else { setPreview(result); setConfirmed(false); }
    } catch(e) { setMessage(e instanceof Error ? e.message : "连接中断，请重试"); setPreview(null); setConfirmed(false); } finally { setBusy(false); }
  }
  const setStageEditing = otherForm?.setStageEditing;
  useEffect(() => { setStageEditing?.(editing || picking || transferring); return () => setStageEditing?.(false); }, [editing, picking, transferring, setStageEditing]);
  const unread = board.events.filter(e => e.unread);
  return <Card className="space-y-4 p-5" id="stage-materials">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="font-medium">{STAGE_LABELS[board.kind]} · 面料、纱线、辅料与工艺</h3><p className="mt-1 text-sm text-[var(--ink-muted)]">{board.label} · 负责人：{board.owners.find(u => u.id === board.ownerId)?.name ?? "待指定"}</p></div><div className="flex flex-wrap gap-2">
      {!historical && !board.locked && !editing ? <Button size="sm" variant="outline" disabled={busy || otherForm?.refreshing} onClick={() => { setRevisionId(board.revisionId ?? ""); setEditStamp(board.stamp); setEditing(true); setTransferring(false); setPicking(false); }}>编辑本阶段用料</Button> : null}
      {!historical && !board.locked && !editing && board.sources.length ? <Button size="sm" variant="outline" disabled={busy || otherForm?.refreshing} onClick={() => { setPicking(!picking); setTransferring(false); }}>选用已有资料</Button> : null}
      {!historical && board.canTransfer && !editing ? <Button size="sm" disabled={busy || otherForm?.refreshing} onClick={() => { setPicking(false); setTransferring(!transferring); }}>转{nextLabel}草稿</Button> : null}
    </div></div>
    <p className="text-sm text-[var(--ink-muted)]">开发 → 销售样 → 大货。每次交接保留来源，下一阶段独立修改；工厂与财务按业务单据接续。</p>
    {board.styleId ? <Link className="inline-block text-sm underline" href={`/styles/${board.styleId}#style-materials`}>查看同一款式主档</Link> : null}
    {picking ? <StageMaterialPicker board={board} onClose={() => { setPicking(false); setRevisionId(""); }} /> : null}
    {board.initialNotice ? <p className="text-sm text-[var(--warning)]">{board.initialNotice}</p> : null}
    {board.order ? <p className="text-sm">已开 <Link className="underline" href={`/orders/${board.order.id}`}>{board.order.orderNo}</Link>，生产资料修订、收料及收付在原订单办理。</p> : null}
    {!board.styleId ? <p className="text-sm text-[var(--warning)]">可先填写材料；交接前请关联正式款式主档。</p> : null}
    {editing ? <form onSubmit={save}><fieldset disabled={busy || otherForm?.refreshing} className="space-y-4"><StyleConstructionFields initial={board.rows} imageBaseUrl={imageBase(board.revisionId)} materials={board.materials} />
      <div className="grid gap-3 md:grid-cols-2"><label>本阶段负责人<select name="ownerId" className={field} defaultValue={board.ownerId}>{board.owners.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}</select></label><label>修改 / 交接说明<input required name="reason" maxLength={2000} className={field} placeholder="例如：二版将大身改为棉纱" /></label></div>
      <p className="text-sm text-[var(--ink-muted)]">新填材料会留到面辅料库供后续选用；建档不表示实物已收货。</p>
      <div className="flex gap-2"><Button type="submit" size="sm">保存并留痕</Button><Button type="button" size="sm" variant="outline" onClick={() => setEditing(false)}>取消</Button></div>
    </fieldset></form> : <details open><summary className="cursor-pointer text-sm">{historical ? "查看历史资料" : "查看本阶段资料"} · {(selected?.rows ?? board.rows).length} 项{selected ? ` · 第 ${selected.number} 次记录` : " · 尚未保存"}</summary>
      {initialRevisionId && !board.history.some(r => r.id === initialRevisionId) ? <p className="mt-3 text-sm text-[var(--warning)]">未找到链接指定的用料记录，当前显示本阶段最新资料，请核对交接记录。</p> : null}
      {historical ? <p className="mt-3 text-sm text-[var(--warning)]">正在查看历史用料快照；本阶段当前为第 {board.history[0]?.number} 次记录。<button type="button" className="ml-2 underline" onClick={() => setRevisionId(board.revisionId ?? "")}>返回当前资料</button></p> : null}
      {board.history.length > 1 ? <label className="block pt-3 text-sm">历史记录<select disabled={busy || picking || transferring} className={field} value={selected?.id ?? ""} onChange={e => setRevisionId(e.target.value)}>{board.history.map(r => <option key={r.id} value={r.id}>第 {r.number} 次 · {r.reason} · {r.createdBy}</option>)}</select></label> : null}
      <StyleConstructionSummary rows={selected?.rows ?? board.rows} references={selected?.references ?? board.seedReferences} imageBaseUrl={imageBase(selected?.id ?? board.revisionId)} />
    </details>}
    {transferring ? <div className="space-y-4 rounded-xl border border-[var(--line)] p-4"><h4>准备{nextLabel}交接</h4><fieldset disabled={busy || otherForm?.refreshing} className="grid gap-3 md:grid-cols-2" onChange={() => { setPreview(null); setConfirmed(false); }}>
      {board.kind === "development" ? <label>采用版单<select required className={field} value={draft.patternRevisionId} onChange={e => setDraft({ ...draft, patternRevisionId: e.target.value })}><option value="">选择已留档版次…</option>{board.patterns.map(p => <option key={p.id} value={p.id} disabled={!p.stageRevisionId}>{p.label} · {p.reason}{p.stageRevisionId ? "" : "（尚未附阶段用料）"}</option>)}</select></label> : null}
      <label>跟单名称<input className={field} maxLength={80} value={draft.title} onChange={e => setDraft({ ...draft, title: e.target.value })} /></label>
      <label>本次交接批次<input className={field} maxLength={80} placeholder="如 SS27 首批；用于避免重复交接" value={draft.batchKey} onChange={e => setDraft({ ...draft, batchKey: e.target.value })} /></label>
      <label>客户<select className={field} value={draft.customerId} onChange={e => setDraft({ ...draft, customerId: e.target.value })}><option value="">请选择</option>{board.customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
      <label>接手人<select className={field} value={draft.ownerId} onChange={e => setDraft({ ...draft, ownerId: e.target.value })}>{board.owners.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
      <label>工厂{board.kind === "sales_sample" ? "（必选）" : "（可后补）"}<select className={field} value={draft.factoryId} onChange={e => setDraft({ ...draft, factoryId: e.target.value })}><option value="">请选择</option>{board.factories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
      <label>季节<input className={field} maxLength={40} value={draft.seasonCode} onChange={e => setDraft({ ...draft, seasonCode: e.target.value })} /></label>
      <label className="md:col-span-2">{board.kind === "sales_sample" ? "销售样确认依据 / 客户确认记录" : "交接依据与待接手事项"}<textarea className={field} rows={2} maxLength={2000} value={draft.basis} onChange={e => setDraft({ ...draft, basis: e.target.value })} placeholder="写明由谁、何时确认，依据哪份客户记录，尚有何待补" /></label>
    </fieldset><Button size="sm" variant="outline" disabled={busy || otherForm?.refreshing} onClick={() => void transfer(false)}>预览本次交接</Button>
      {preview ? <div className="space-y-3 text-sm"><p>{preview.source} → {preview.targetKind} · {preview.itemCount} 项用料与工艺 · {preview.referenceCount} 项原表补充资料</p><p>{preview.customer} · {preview.factory} · 接手人：{preview.owner}</p><ul className="list-disc pl-5">{preview.notes.map(n => <li key={n}>{n}</li>)}</ul><label className="flex gap-2"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />我已核对选定资料与交接依据</label><Button size="sm" disabled={busy || !confirmed} onClick={() => void transfer(true)}>确认生成{nextLabel}草稿</Button></div> : null}
    </div> : null}
    {board.transfers.length ? <details><summary className="cursor-pointer text-sm">交接记录 · {board.transfers.length} 条</summary><ul className="space-y-3 pt-3 text-sm">{board.transfers.map(t => <li key={t.id} className="space-y-1 border-b border-[var(--line)] pb-3">
      {t.href ? <Link className="underline" href={t.href}>{t.outgoing ? "已交接到" : "来源"} {t.kind} · {t.batchKey}</Link> : <p>原记录暂不可打开，请核对归属。</p>}
      <p>采用：{t.versionLabel}</p><p className="text-[var(--ink-muted)]">{t.actor} · {new Date(t.createdAt).toLocaleString("zh-CN")}</p>
      <p className="whitespace-pre-wrap break-words">交接依据：{t.basis || "历史记录未填写，待核对"}</p>
    </li>)}</ul></details> : null}
    {board.events.length ? <details><summary className="cursor-pointer text-sm">变更记录{unread.length ? <span className="ml-2 text-[var(--danger)]">● {unread.length} 条未阅</span> : " · 已阅"}</summary><div className="space-y-3 pt-3 text-sm">{board.events.map(e => <article key={e.id} className="border-b border-[var(--line)] pb-2"><p>{e.unread ? "● " : ""}{e.summary}</p><p className="text-[var(--ink-muted)]">{e.actor} · {new Date(e.createdAt).toLocaleString("zh-CN")}</p>{e.detail.changes?.map((c, i) => <p key={i}>{c}</p>)}</article>)}{unread.length ? <Button size="sm" variant="outline" disabled={busy || otherForm?.refreshing} onClick={async () => { setBusy(true); try { const r = await jsonCall({ action: "read", stageId: board.stageId, auditIds: unread.map(e => e.id) }); setMessage(r.message); router.refresh(); } catch(e) { setMessage(e instanceof Error ? e.message : "标记失败"); } finally { setBusy(false); } }}>我已查看这些变更</Button> : null}<p className="text-[var(--ink-muted)]">只标记本人已阅，不代替审批。完整前后资料可从历史版本查看。</p></div></details> : null}
    {message ? <p role="status" className="text-sm">{message}</p> : null}
  </Card>;
}
