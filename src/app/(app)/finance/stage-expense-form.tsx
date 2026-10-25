"use client";
import { useEffect, useState } from "react";
import type { expenseSubject } from "@/server/services/stage-expenses";
import type { TradeOption } from "@/server/services/trade-lookup";
import { EXPENSE_KINDS } from "@/server/services/trade-contract";
import { FileWell } from "@/components/file-well";
import { CurrencySelect, Field, FormResult, Lookup, tradeField, useTradeCommand } from "./trade-form-parts";

type Subject = Awaited<ReturnType<typeof expenseSubject>>;
export function StageExpenseForm({ fixedSubject, today }: { fixedSubject?: Subject; today: string }) {
  const state = useTradeCommand(), [kind, setKind] = useState("expense_projects"), [target, setTarget] = useState<TradeOption | null>(null), [subject, setSubject] = useState<Subject | null>(fixedSubject ?? null);
  const [party, setParty] = useState<TradeOption | null>(null), [currency, setCurrency] = useState("CNY"), [error, setError] = useState("");
  useEffect(() => {
    if (fixedSubject || !target) return;
    const controller = new AbortController();
    const params = new URLSearchParams({ [kind === "expense_projects" ? "projectId" : "followRowId"]: target.id });
    fetch(`/api/finance/stage-expenses/subject?${params}`, { cache: "no-store", signal: controller.signal }).then(async response => {
      const data = await response.json(); if (!response.ok) throw new Error(data.error || "所属资料未能读取");
      if (!controller.signal.aborted) setSubject(data);
    }).catch(e => { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "查阅失败"); });
    return () => controller.abort();
  }, [fixedSubject, kind, target]);
  return <form className="space-y-4" onSubmit={event => void state.submit(event, { action: "create_stage_expense", projectId: subject?.projectId ?? "", followRowId: subject?.followRowId ?? "", expectedStamp: subject?.stamp, partyId: party?.id })}>
    {!fixedSubject ? <><Field label="费用发生阶段"><select className={tradeField} value={kind} onChange={e => { setKind(e.target.value); setTarget(null); setSubject(null); setError(""); }}><option value="expense_projects">开发打版</option><option value="expense_sales">销售样 · 未开生产单</option><option value="expense_bulk">大货跟单 · 未开生产单</option></select></Field><Lookup key={kind} label="费用所属款式 / 开发" kind={kind} selected={target} onSelect={v => { setTarget(v); setSubject(null); setError(""); }} /></> : null}
    {subject ? <p className="rounded-xl bg-[var(--paper)] p-3 text-sm leading-6">{subject.label}<br /><span className="text-[var(--ink-muted)]">费用保留原阶段。转大货供回查，由财务逐笔决定是否分摊。</span></p> : null}
    {error ? <p role="alert" className="text-sm text-[var(--danger)]">{error}</p> : null}
    <Lookup label="结算供应商或工厂" kind="parties" selected={party} onSelect={setParty} />
    <div className="grid gap-4 sm:grid-cols-2"><Field label="费用名称"><input name="title" required maxLength={120} className={tradeField} placeholder="例如 头版样衣加工费" /></Field><Field label="费用类别"><select name="expenseKind" className={tradeField}>{Object.entries(EXPENSE_KINDS).map(([key, name]) => <option key={key} value={key}>{name}</option>)}</select></Field><Field label="币种"><CurrencySelect value={currency} onChange={setCurrency} /></Field><Field label="本笔费用金额"><input name="amount" required inputMode="decimal" maxLength={32} className={tradeField} /></Field><Field label="费用发生日"><input name="expenseDate" type="date" defaultValue={today} required className={tradeField} /></Field><Field label="约定付款日"><input name="dueDate" type="date" required className={tradeField} /></Field></div>
    <Field label="费用凭据号 / 内部识别号"><input name="expenseReference" required maxLength={120} placeholder="同张凭据有多笔费用时，加分项编号" className={tradeField} /></Field>
    <Field label="费用依据"><textarea name="basis" required maxLength={2000} rows={3} placeholder="实际买料、打样或服务约定，以及本笔费用归属依据" className={tradeField} /></Field>
    <FileWell label="费用凭据" hint="可后补 · JPG / PNG / PDF，最多 8MB" accept="image/jpeg,image/png,application/pdf" compact />
    <p className="text-xs leading-6 text-[var(--ink-muted)]">保存为待核对草稿。财务确认后计入应付，再关联已发生付款；不增加库存或发起银行付款。</p>
    <FormResult state={state} label="保存费用草稿" disabled={!subject?.canCreate || !party} href="/finance/bills/:id" />
  </form>;
}
