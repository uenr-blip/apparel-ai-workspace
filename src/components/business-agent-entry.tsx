"use client";
import { CreateFollowSheetForm } from "@/app/(app)/orders/create-follow-sheet-form";
import { VoiceInput } from "@/components/voice-input";
import { useEffect, useState } from "react";
import { AgentResultTable } from "@/components/agent-result-table";
import { PatternReferenceSuggestion } from "@/components/pattern-reference-suggestion";
import { CatalogCompose } from "@/components/catalog-compose";
import { Button } from "@/components/ui/button";
import type { AgentProfile } from "@/lib/agent-config";
import type { AgentModule } from "@/server/agents/business-tools";
import type { runBusinessAgent } from "@/server/agents/business-agent";
import { AGENT_RESULT_VERSION } from "@/lib/agent-table";

type Result = Awaited<ReturnType<typeof runBusinessAgent>>;
const entries = {
  product: { label: "开发与款式", example: "找个类似去年圆领卫衣的款，顺便核对 ST-26018 的资料有没有批准", note: "直接说要找的资料或要核对的审版情况，我会选择所需查询，并列出依据。" },
  production: { label: "生产进度", example: "这周要交的订单卡在哪里？或 DEMO-ORD-002 适合排给哪家厂？", note: "按问题查交期、料况、进度或询厂依据；更改工厂、交期和投产仍按原流程确认。" },
  follow: { label: "跟单", example: "帮我建一张 SS27 大货跟单，工厂是云杉制衣厂", note: "可按 PO、产品编号、颜色或客户采购日期查跟单。新建时准备可修改的表头，确认后进入跟单表加款；不会自动填写款式数量。" },
  workspace: { label: "工作台", example: "这周要交的订单，哪些有风险，分别卡在哪里？", note: "跨模块核对交期、资料、分色、料况和生产记录，给出依据与处理入口。只查当前账号可看的业务。" },
  development: { label: "款式助手", example: "找个类似去年那款圆领卫衣的版型", note: "先找款，再核对版次、面料和工艺；结果是资料匹配，采用前需重新确认。" },
  scheduling: { label: "排产助手", example: "DEMO-ORD-001 这个订单排给谁", note: "核对交期、在手订单和历史产量。缺产能时只列询厂依据；修改交期需要主管确认。" },
  finance: { label: "对账助手", example: "北岸服饰还有哪些没对上的", note: "可查客户未结款项，也可按开发编号或款号查阶段费用与原凭据。草稿不计欠款；分摊、改账和付款仍由财务核对办理。" },
  review: { label: "审版助手", example: "ST-26018 这个版审过了吗", note: "查资料批准凭据和历史；资料批准不能替代客户基础样审版。修订必须保留原款和版次关系。" },
};
export function BusinessAgentEntry({ module, initialText = "" }: { module: Exclude<AgentModule, "order">; initialText?: string }) {
  const entry = entries[module];
  return <CatalogCompose assistant label="问衣据" title={`问衣据 · ${entry.label}`} note={entry.note}><AgentForm module={module} initialText={initialText} /></CatalogCompose>;
}
export function AgentConnectionStatus({ value = "default", onChange, disabled = false }: { value?: AgentProfile; onChange?: (profile: AgentProfile) => void; disabled?: boolean }) {
  const [data, setData] = useState<{ label: string; options?: Array<{ profile: AgentProfile; name: string; label: string; ready: boolean }> }>({ label: "正在核对模型配置…" });
  useEffect(() => { const controller = new AbortController(); void fetch("/api/agents", { signal: controller.signal }).then(r => r.json()).then(r => setData(r.label ? r : { label: r.error || "配置暂不可读" })).catch(() => { if (!controller.signal.aborted) setData({ label: "配置暂不可读，请刷新" }); }); return () => controller.abort(); }, []);
  const selected = data.options?.find(o => o.profile === value);
  return <div className="space-y-2 text-sm">
    <details><summary className="cursor-pointer text-xs text-[var(--ink-muted)]">连接设置</summary>
    {onChange ? <label className="block">本次使用的模型<select aria-label="本次使用的模型" value={value} disabled={disabled || !data.options} onChange={e => onChange(e.target.value as AgentProfile)} className="ml-2 rounded-lg border border-[var(--line)] bg-[var(--field-solid)] p-2">
      {(data.options ?? [{ profile: "default", name: "默认模型", ready: false }]).map(o => <option key={o.profile} value={o.profile}>{o.name}{o.ready ? "" : " · 待配置"}</option>)}
    </select></label> : null}
    <p className="text-[var(--ink-muted)]" role="status">{selected?.label || data.label}</p>
    </details>
    {onChange ? <p className="text-xs text-[var(--ink-muted)]">查询内容和所需业务摘要会发给所选模型服务商；失败不会自动切换。</p> : null}
  </div>;
}
function AgentForm({ module, initialText }: { module: Exclude<AgentModule, "order">; initialText: string }) {
  const [profile, setProfile] = useState<AgentProfile>("default");
  const [text, setText] = useState(initialText), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const staleResult = result && (module === "workspace" || module === "production") && result.resultVersion !== AGENT_RESULT_VERSION;
  async function submit() {
    setBusy(true); setError(""); setResult(null);
    try {
      const response = await fetch("/api/agents", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ module, text, profile }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || "查询未完成"); setResult(data);
    } catch (e) { setError(e instanceof Error ? e.message : "查询未完成"); } finally { setBusy(false); }
  }
  return <div className="space-y-4">
    <AgentConnectionStatus value={profile} disabled={busy} onChange={value => { setProfile(value); setResult(null); setError(""); }} />
    <label className="block text-sm">说清你要核对的事，我帮你列成表<textarea aria-label={entries[module].label} maxLength={1000} disabled={busy} value={text} onChange={e => { setText(e.target.value); setResult(null); }} placeholder={entries[module].example} className="mt-2 min-h-24 w-full rounded-xl border border-[var(--line)] bg-[var(--field-solid)] p-3" /></label>
    <VoiceInput disabled={busy} onApply={value => { setText(current => current.trim() ? `${current.trimEnd()}\n${value}` : value); setResult(null); setError(""); }} />
    {text.length > 1000 ? <p role="alert" className="text-sm text-[var(--danger)]">输入内容超过1000字，请在上方输入框精简后再提交。已保留全部文字。</p> : null}
    <Button type="button" disabled={busy || text.trim().length < 2 || text.length > 1000} onClick={() => void submit()}>{busy ? "正在查资料和核对依据…" : "开始核对"}</Button>
    {error ? <p role="alert" className="text-sm text-[var(--danger)]">{error}</p> : null}
    {result ? <section className="space-y-3" aria-label="智能体查询结果">
      {staleResult ? <p role="status" className="rounded-xl border border-[var(--warning)] p-4 text-sm">核对规则已更新，请重新点击“开始核对”。旧结果不能作为“没有风险”的结论。</p> : <>
      <p className="text-sm font-medium">{result.tables?.some(t => t.conclusion) ? "本次核对结论" : result.followDraft ? "请核对待确认草稿" : result.tables?.some(t => t.rows.length) ? "已找到以下记录，请核对内容和待处理项。" : "本次未找到可列出的业务记录，请查看缺项说明。"}</p>
      {result.patternSuggestion && <PatternReferenceSuggestion key={result.runId} suggestion={result.patternSuggestion}/>}
      {((!result.evidenceRead && !result.tables?.some(t => t.conclusion)) || (module === "follow" && !result.followDraft)) ? <AgentResultTable table={{ title: "需要补充", columns: ["项目", "请补充后重新核对"], rows: [{ cells: ["本次要求", result.answer] }], emptyMessage: "请补充业务对象。" }} /> : null}
      {result.followDraft && result.followTicket ? <div className="space-y-3"><p className="text-sm">这是待确认草稿，修改后请重新勾选确认。</p><CreateFollowSheetForm key={result.runId} suggestion={result.followDraft} assistantTicket={result.followTicket} /></div> : null}
      {(result.tables ?? []).map((table, i) => <AgentResultTable key={i} table={table} />)}
      <details className="text-sm">
        <summary className="cursor-pointer text-[var(--ink-muted)]">查看原始记录与核对过程</summary>
        <div className="mt-3 space-y-3">
          <p className="text-xs text-[var(--ink-muted)]">这里列的是结论的来源和查询过程，不是“通过”或“无风险”的评级；处理事项请看上方结论和订单表。</p>
          <p className="whitespace-pre-wrap">{result.answer}</p>
          <p className="text-xs text-[var(--ink-muted)]">{result.status.label} · 已执行：{result.steps.join(" → ")}</p>
          <p className="text-xs text-[var(--ink-muted)]">依据版本：{result.context.platformVersion} · 企业补充 {result.context.references.length} 份 · 查询记录 {result.runId.slice(0,8)}</p>
          <AgentResultTable table={{ title: "核对来源（原始记录）", columns: ["业务记录", "核对内容"], rows: result.cards.map(card => ({ href: card.href, cells: [card.title, card.facts.join("\n")] })), emptyMessage: "本次没有详细依据。" }} />
        </div>
      </details>
      </>}
    </section> : null}
  </div>;
}
