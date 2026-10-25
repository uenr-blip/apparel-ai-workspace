"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { StyleConstructionSummary } from "@/app/(app)/styles/style-construction-fields";
import { useFollowEditState } from "@/app/(app)/orders/follow-edit-state";
import type { StageWorkspace, previewStageMaterialSource } from "@/server/services/workflow-stage";

export function StageMaterialPicker({ board, onClose }: { board: StageWorkspace; onClose: () => void }) {
  const router = useRouter(), otherForm = useFollowEditState();
  const [choice, setChoice] = useState(""), [reason, setReason] = useState(""), [confirmed, setConfirmed] = useState(false), [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const [preview, setPreview] = useState<Awaited<ReturnType<typeof previewStageMaterialSource>> | null>(null);
  const [requestKey] = useState(() => crypto.randomUUID());
  const selected = board.sources[Number(choice)];
  function invalidate() { setPreview(null); setConfirmed(false); }
  async function submit(final: boolean) {
    if (otherForm?.dirty) { setMessage("请先保存下方跟单表的改动，再选用资料"); return; }
    if (choice === "" || !selected || !reason.trim()) { setMessage("请选择来源并填写选用依据"); return; }
    setBusy(true); setMessage("");
    try {
      const r = await fetch("/api/workflow/stages", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: final ? "adoptMaterials" : "previewMaterials", input: { target: board.target, source: selected.source, reason }, expectedStamp: preview?.stamp, requestKey, confirmed }) });
      const result = await r.json(); if (!r.ok) throw new Error(result.error || "选用失败");
      if (final) { onClose(); router.refresh(); } else { setPreview(result); setConfirmed(false); }
    } catch(e) { setMessage(e instanceof Error ? e.message : "连接中断，请重试"); if (!final) invalidate(); } finally { setBusy(false); }
  }
  return <section className="space-y-3 rounded-xl border border-[var(--line)] p-4" aria-label="选用已有资料"><h4 className="font-medium">选用已有资料</h4>
    <p className="text-sm text-[var(--ink-muted)]">先选定本款主档版本，或同客户的销售样版本；核对后带入本阶段。历史批次不会跟着变。</p>
    <fieldset disabled={busy} className="space-y-3"><label className="block text-sm">资料来源<select className="mt-1 block w-full rounded border border-[var(--line)] bg-[var(--surface)] p-2" value={choice} onChange={e => { setChoice(e.target.value); invalidate(); }}><option value="">请选择具体版本…</option>{board.sources.map((s, i) => <option key={i} value={i}>{s.label}</option>)}</select></label>
      {choice !== "" && selected ? <Link className="text-sm underline" href={selected.href} target="_blank">查看来源记录</Link> : null}
      <label className="block text-sm">选用依据<input className="mt-1 block w-full rounded border border-[var(--line)] bg-[var(--surface)] p-2" value={reason} maxLength={2000} placeholder="例如：按客户确认的销售样准备本批资料" onChange={e => { setReason(e.target.value); invalidate(); }} /></label>
      <div className="flex gap-2"><Button size="sm" type="button" variant="outline" onClick={() => void submit(false)}>预览选用资料</Button><Button size="sm" type="button" variant="outline" onClick={onClose}>取消</Button></div>
      {preview ? <div className="space-y-3"><p className="text-sm">{preview.label} · {preview.rows.length} 项（当前 {preview.currentCount} 项）</p><p className="text-sm">{preview.message}</p><StyleConstructionSummary rows={preview.rows} references={preview.references} imageBaseUrl={preview.imageBaseUrl} /><label className="flex gap-2 text-sm"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />我已核对，确认用这份资料替换本阶段用料与工艺</label><Button type="button" size="sm" disabled={!confirmed} onClick={() => void submit(true)}>确认选用并留痕</Button></div> : null}
    </fieldset>{message ? <p role="status" className="text-sm">{message}</p> : null}
  </section>;
}
