"use client";

import { VoiceInput } from "@/components/voice-input";
import { AgentConnectionStatus } from "@/components/business-agent-entry";
import { AgentResultTable } from "@/components/agent-result-table";
import type { AgentProfile } from "@/lib/agent-config";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import type { previewOrderAssistant, searchOrderAssistant } from "@/server/services/order-assistant";

type Search = Awaited<ReturnType<typeof searchOrderAssistant>> & { resolvedText?: string; steps?: string[] };
type Preview = Awaited<ReturnType<typeof previewOrderAssistant>>;

async function command<T>(body: object): Promise<T> {
  const response = await fetch("/api/orders/assistant", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "暂时未完成，请重试");
  return data as T;
}

export function OrderAssistantForm() {
  const router = useRouter();
  const [profile, setProfile] = useState<AgentProfile>("default");
  const [text, setText] = useState("");
  const [data, setData] = useState<Search | null>(null);
  const [candidateId, setCandidateId] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [key, setKey] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ orderId: string; orderNo: string } | null>(null);
  const candidate = preview?.candidate ?? data?.candidates.find(c => c.id === candidateId);
  const terms = preview ? preview.terms : data?.candidates.find(c => c.id === candidateId)?.terms;

  async function run(action: "search" | "preview" | "confirm") {
    setBusy(true); setError("");
    try {
      if (action === "search") {
        setPreview(null); setConfirmed(false); setData(null); setCandidateId("");
        const found = await command<Search>({ action, text, profile });
        setData(found); if (found.resolvedText) setText(found.resolvedText); setCandidateId(found.candidates.length === 1 ? found.candidates[0].id : "");
        setKey(crypto.randomUUID());
      } else if (action === "preview") {
        const created = await command<Preview>({ action, text, candidateId, idempotencyKey: key });
        setPreview(created); setConfirmed(false);
      } else if (preview) {
        const created = await command<{ orderId: string; orderNo: string }>({ action, proposalId: preview.proposalId, confirmed });
        setResult(created); router.refresh();
      }
    } catch (e) { setError(e instanceof Error ? e.message : "暂时未完成，请重试"); }
    finally { setBusy(false); }
  }

  if (result) return (
    <div className="space-y-3" role="status">
      <p>已创建 {result.orderNo} 草稿。</p>
      <p className="text-sm text-[var(--ink-muted)]">本单已有补资料和账期核对待办。尚未采购、投产或付款。</p>
      <Link href={`/orders/${result.orderId}`} className="text-[var(--brand-strong)] underline">打开订单，补齐本单资料</Link>
    </div>
  );

  return (
    <div className="space-y-4">
      <AgentConnectionStatus value={profile} disabled={busy || Boolean(preview)} onChange={value => { setProfile(value); setData(null); setCandidateId(""); setError(""); }} />
      <p className="text-sm text-[var(--ink-muted)]">先理解你的要求、查找客户，再从该客户已有订单找参考资料，由你核对后确认。本轮识别客户和款类/款号；原话里的数量、颜色、交期等仍须到本单资料核对填写。</p>
      <label className="block text-sm">说清客户和要做的款
        <textarea aria-label="一句话建单要求" maxLength={1000} disabled={busy || Boolean(preview)} value={text}
          onChange={e => { setText(e.target.value); setData(null); setCandidateId(""); }}
          placeholder="例如：给北岸服饰建一个针织T恤订单，基础样已确认"
          className="mt-2 min-h-24 w-full rounded-xl border border-[var(--line)] bg-[var(--field-solid)] p-3" />
      </label>
      <VoiceInput disabled={busy || Boolean(preview)} onApply={value => { setText(current => current.trim() ? `${current.trimEnd()}\n${value}` : value); setData(null); setCandidateId(""); setPreview(null); setConfirmed(false); setError(""); }} />
      {text.length > 1000 ? <p role="alert" className="text-sm text-[var(--danger)]">输入内容超过1000字，请在上方输入框精简后再提交。已保留全部文字。</p> : null}
      <Button type="button" disabled={busy || text.length > 1000} onClick={() => void run("search")}>{busy ? "正在核对…" : preview ? "重新匹配资料" : "找客户历史资料"}</Button>
      {data ? <>
        <p className="text-sm">{data.modeLabel}{data.steps ? ` · ${data.steps.join(" → ")}` : ""}</p>
        <p>客户：{data.customer.name}（{data.customer.code}）</p>
        <p className="text-sm text-[var(--ink-muted)]">以下是历史参考，不是已确认的客户偏好。款类相近不代表同款；有多个候选时请选定实际基础样。</p>
        {data.limited ? <p>仅查看最近 100 条历史订单明细；未找到时请核对历史资料。</p> : null}
        {!data.candidates.length ? <p role="status">没有找到该客户带已批准版本的匹配历史单。请核对客户/款号，或先在款式档案建档，不能凭空生成规格。</p> : (
          <label className="block text-sm">选择参考单与版次
            <select aria-label="参考历史订单" className="mt-2 w-full rounded-xl border border-[var(--line)] bg-[var(--field-solid)] p-2" value={candidateId} disabled={busy || Boolean(preview)}
              onChange={e => { setCandidateId(e.target.value); setKey(crypto.randomUUID()); setConfirmed(false); }}>
              <option value="">请选择基础样对应的资料</option>
              {data.candidates.map(c => <option key={c.id} value={c.id}>{c.orderNo} · {c.styleCode} {c.styleName} · V{c.versionNumber}</option>)}
            </select>
          </label>
        )}
      </> : null}
      {candidate ? <AgentResultTable table={{ title: preview ? "生产订单草稿 · 待确认提交" : "历史参考 · 待本单核对", columns: ["项目", "内容"], rows: [
        { cells: ["客户", data ? `${data.customer.name}（${data.customer.code}）` : null] },
        { cells: ["款式", `${candidate.styleCode} ${candidate.styleName}`] },
        { href: `/orders/${candidate.orderId}`, cells: ["来源订单", `${candidate.orderNo} / V${candidate.versionNumber}`] },
        { cells: ["规格", candidate.specNotes || "未记录尺寸规格，需补齐"] },
        { cells: ["袖口 / 版次", `${candidate.cuffType || "未记录"} / ${candidate.patternRevision || "未记录"}`] },
        { cells: ["工艺", candidate.processNotes || null] },
        { cells: ["历史颜色 / 尺码", `${candidate.colors.join("、") || "未记录"} / ${candidate.sizes.join("、") || "未记录"}；不沿用旧单件数`] },
        { cells: ["面辅料", candidate.materials.map(m => `${m.code} ${m.name}（参考单耗 ${m.consumption} ${m.unit}）`).join("\n") || null] },
        { cells: ["账期参考", terms ? `${terms.terms}（来源 ${terms.orderNo}，待本单重新核对）` : "未带入；无一致记录或无查阅权限，交经理/财务核对"] },
        { cells: ["本单待补", "数量、颜色分配、色尺数量、交期、基础样凭据；客户 PO 可空"] },
      ], notes: ["参考有误可返回修改要求或选择其他资料。提交后再在本单资料补齐字段。", "只创建待补资料的草稿，不覆盖历史版本；口头基础样确认不代替本单资料批准。", "账期仅保留来源引用，不生成合同金额和应收。"], emptyMessage: "尚未选定参考资料。" }} /> : null}
      {candidate && !preview ? <Button type="button" disabled={busy} onClick={() => void run("preview")}>生成草稿预览</Button> : null}
      {preview ? <>
        <Button type="button" variant="secondary" disabled={busy} onClick={() => { setPreview(null); setConfirmed(false); setData(null); setCandidateId(""); setKey(crypto.randomUUID()); setError(""); }}>返回修改要求或参考资料</Button>
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={confirmed} disabled={busy} onChange={e => setConfirmed(e.target.checked)} />我已核对客户、基础样对应的版次和参考资料；确认只建待补资料的草稿，不批准、不采购、不投产、不付款。</label>
        <Button type="button" disabled={busy || !confirmed} onClick={() => void run("confirm")}>{busy ? "正在提交…" : "确认提交草稿订单"}</Button>
      </> : null}
      {error ? <p role="alert" className="text-sm text-[var(--danger)]">{error}</p> : null}
    </div>
  );
}
