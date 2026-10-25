"use client";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { CONTEXT_SCOPES, SCOPE_NAMES, type ContextScope } from "@/server/context/platform";
import type { listContext } from "@/server/context/context-service";
type Data = Awaited<ReturnType<typeof listContext>>;
export function ContextManager() {
  const [data, setData] = useState<Data | null>(null), [scope, setScope] = useState<ContextScope>("company");
  const [title, setTitle] = useState(""), [text, setText] = useState(""), [source, setSource] = useState("");
  const [selected, setSelected] = useState(""), [confirmed, setConfirmed] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const current = data?.versions.find(r => r.id === data.active[scope]), draft = data?.versions.find(r => r.id === selected), proposal = data?.proposals.find(p => p.revisionId === selected);
  async function reload() { const r = await fetch("/api/context"); const d = await r.json(); if (!r.ok) throw new Error(d.error); setData(d); }
  useEffect(() => { const controller = new AbortController(); void fetch("/api/context", { signal: controller.signal }).then(async r => { const d = await r.json(); if (!r.ok) throw new Error(d.error); return d; }).then(setData).catch(e => { if (!controller.signal.aborted) setError(e.message); }); return () => controller.abort(); }, []);
  async function act(action: "draft" | "publish") {
    setBusy(true); setError("");
    try {
      const r = await fetch("/api/context", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(action === "draft" ? { action, draft: { scope, title, text, source, baseId: data?.active[scope] ?? null, idempotencyKey: crypto.randomUUID() } } : { action, proposalId: proposal?.id, confirmed }) });
      const d = await r.json(); if (!r.ok) throw new Error(d.error); await reload(); setSelected(d.revisionId); setConfirmed(false);
    } catch(e) { setError(e instanceof Error ? e.message : "未完成"); } finally { setBusy(false); }
  }
  const field = "w-full rounded-lg border border-[var(--line)] bg-[var(--field-solid)] p-2";
  return <section className="space-y-4 rounded-2xl border border-[var(--line)] p-5">
    <h3 className="font-medium">企业上下文与版本</h3>
    <p className="text-sm text-[var(--ink-muted)]">记录企业术语、操作约定和参考来源。草稿不会进入智能体；经理核对后发布。当前访谈规则尚待一线实际操作验收。这里的发布只更新业务参考；审批和状态流转的改动须同步修改程序并验证。权限、付款限制和投产门槛不能在这里更改。全公司共享内容不要放财务敏感信息。</p>
    <p className="text-xs">平台规则：{data?.platformVersion || "读取中"}</p>
    <label className="block text-sm">适用范围<select className={field} value={scope} disabled={busy} onChange={e => { setScope(e.target.value as ContextScope); setSelected(""); setTitle(""); setText(""); setSource(""); setConfirmed(false); }}>{CONTEXT_SCOPES.map(s => <option key={s} value={s}>{SCOPE_NAMES[s]}</option>)}</select></label>
    <div className="grid gap-4 md:grid-cols-2"><div className="space-y-2 text-sm"><p className="font-medium">当前生效</p><p>{current?.title || "尚无企业补充，使用平台规则"}</p><p className="whitespace-pre-wrap">{current?.text}</p><p className="text-xs">{current ? `版本 ${current.id} · 来源 ${current.source}` : ""}</p></div>
    <div className="space-y-2 text-sm"><p className="font-medium">准备新版本</p><input aria-label="上下文标题" className={field} maxLength={80} placeholder="标题，例如：针织开发用语约定" value={title} onChange={e => setTitle(e.target.value)} disabled={busy} /><textarea aria-label="上下文内容" className={`${field} min-h-32`} maxLength={6000} placeholder="粘贴或填写经核对的业务约定；不要粘贴密钥、账号权限或未经确认的金额。" value={text} onChange={e => setText(e.target.value)} disabled={busy} /><input aria-label="上下文来源" className={field} maxLength={500} placeholder="来源/负责人/日期，例如：开发部会议确认，2026-09-24" value={source} onChange={e => setSource(e.target.value)} disabled={busy} /><Button disabled={busy || !data} onClick={() => void act("draft")}>保存草稿，查看发布预览</Button></div></div>
    <label className="block text-sm">历史版本<select className={field} value={selected} onChange={e => { setSelected(e.target.value); setConfirmed(false); }}><option value="">选择版本查看</option>{data?.versions.filter(r => r.scope === scope).map(r => <option key={r.id} value={r.id}>{r.createdAt} · {r.title}{r.id === data.active[scope] ? " · 生效中" : ""}</option>)}</select></label>
    {draft ? <div className="space-y-3 rounded-xl border border-[var(--line)] p-3 text-sm"><p className="font-medium">所选版本：{draft.title}</p><p className="whitespace-pre-wrap">{draft.text}</p><p>来源：{draft.source}</p><p>创建人：{draft.createdBy} · {draft.createdAt}</p><p>发布将替换上方当前生效内容，保留原版和历史记录。</p>
      {proposal ? <><label className="flex gap-2"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} disabled={busy} />我已核对来源、适用范围和内容差异，确认发布为企业业务参考。</label><Button disabled={busy || !confirmed} onClick={() => void act("publish")}>确认发布此版本</Button></> : null}
      <Button variant="outline" disabled={busy} onClick={() => { setTitle(draft.title); setText(draft.text); setSource(`参考历史版本 ${draft.id}；请补充本次确认依据`); }}>复制为新草稿 / 准备回滚</Button>
    </div> : null}
    {data?.limited ? <p>仅列最近100个版本。</p> : null}{error ? <p role="alert" className="text-sm text-[var(--danger)]">{error}</p> : null}
  </section>;
}
