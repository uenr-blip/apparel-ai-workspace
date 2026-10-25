"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { CURRENCIES } from "@/lib/trade-money";
import { Field, FormResult, Lookup, tradeField, useTradeCommand } from "./trade-form-parts";
import type { ReconciliationRule, ReconRole } from "@/server/services/reconciliation-rules";
type Selection = { role: ReconRole; label: string; accounts: Array<{ id: string; label: string }> };
export function ReconciliationRuleForm({ bookId, baseCurrency, rule, selections }: { bookId: string; baseCurrency: string; rule: ReconciliationRule | null; selections: Selection[] }) {
  const state = useTradeCommand("/api/finance/reconciliation");
  const [accounts, setAccounts] = useState(Object.fromEntries(selections.map(s => [s.role, s.accounts])) as Record<ReconRole, Array<{ id: string; label: string }>>);
  const [rates, setRates] = useState(rule?.rates ?? []);
  const currencies = Object.keys(CURRENCIES).filter(c => c !== baseCurrency);
  return <form className="space-y-5" onSubmit={e => void state.submit(e, { action: "save_reconciliation_rule", bookId, expectedVersion: rule?.version ?? 0, accounts: Object.fromEntries(selections.map(s => [s.role, accounts[s.role].map(a => a.id)])), rates })}>
    <p className="rounded-xl bg-[var(--paper)] p-3 text-sm leading-7">选择本演示账簿要比较的科目。核对汇率只改变比较结果，不修改凭证，也不执行汇兑重估。未确认的项目可暂留空。</p>
    {selections.map(s => <section key={s.role} className="space-y-2 rounded-xl border border-[var(--line)] p-3"><h3 className="text-sm font-semibold">{s.label}</h3><div className="flex flex-wrap gap-2">{accounts[s.role].map(a => <span key={a.id} className="inline-flex max-w-full items-center gap-2 rounded-lg bg-[var(--paper)] px-2 py-1 text-xs"><span className="break-words">{a.label}</span><button type="button" aria-label={`移除${a.label}`} onClick={() => setAccounts(old => ({ ...old, [s.role]: old[s.role].filter(x => x.id !== a.id) }))} className="px-1">×</button></span>)}</div>
      <Lookup label={`${s.label}科目`} kind={s.role} endpoint="/api/finance/reconciliation" bookId={bookId} selected={null} onSelect={a => { if (a) setAccounts(old => ({ ...old, [s.role]: old[s.role].some(x => x.id === a.id) ? old[s.role] : [...old[s.role], a] })); }} />
    </section>)}
    <section className="space-y-3"><h3 className="text-sm font-semibold">外币核对汇率 · 折算为 {baseCurrency}</h3><p className="text-xs leading-6 text-[var(--ink-muted)]">原币先按台账合计，再按这里的汇率折算。与凭证历史汇率不同时会产生差异，须核对原因，不能直接据此调账。</p>
      {rates.map((r, i) => <div key={i} className="space-y-3 rounded-xl border border-[var(--line)] p-3"><div className="grid grid-cols-2 gap-3"><Field label="原币"><select aria-label={`核对币种${i + 1}`} value={r.currency} onChange={e => setRates(old => old.map((x, k) => k === i ? { ...x, currency: e.target.value } : x))} className={tradeField}>{currencies.map(c => <option key={c}>{c}</option>)}</select></Field><Field label={`1 ${r.currency} = 多少 ${baseCurrency}`}><input aria-label={`核对汇率${i + 1}`} required inputMode="decimal" value={r.rate} onChange={e => setRates(old => old.map((x, k) => k === i ? { ...x, rate: e.target.value } : x))} className={tradeField} /></Field></div><Field label="汇率日期"><input aria-label={`汇率日期${i + 1}`} required type="date" value={r.date} onChange={e => setRates(old => old.map((x, k) => k === i ? { ...x, date: e.target.value } : x))} className={tradeField} /></Field><Field label="汇率依据"><input required maxLength={1000} value={r.basis} onChange={e => setRates(old => old.map((x, k) => k === i ? { ...x, basis: e.target.value } : x))} className={tradeField} /></Field><button type="button" className="text-xs text-[var(--danger)]" onClick={() => setRates(old => old.filter((_, k) => k !== i))}>移除此币种</button></div>)}
      <Button type="button" variant="secondary" disabled={rates.length >= currencies.length} onClick={() => setRates(old => [...old, { currency: currencies.find(c => !old.some(r => r.currency === c)) ?? currencies[0], rate: "", date: "", basis: "" }])}>添加核对币种</Button>
    </section>
    <Field label="本次核对口径依据"><textarea name="basis" required maxLength={2000} rows={3} defaultValue={rule?.basis ?? ""} className={tradeField} placeholder="说明科目范围和折算用途；当前仅供演示核对。" /></Field><FormResult state={state} label="保存演示核对口径" />
  </form>;
}
