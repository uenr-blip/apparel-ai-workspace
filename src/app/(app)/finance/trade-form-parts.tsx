"use client";
import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { CURRENCIES } from "@/lib/trade-money";
import { Button } from "@/components/ui/button";
import type { TradeOption } from "@/server/services/trade-lookup";

export const tradeField = "mt-1 w-full rounded-xl border border-[var(--line)] bg-[var(--field-solid)] px-3 py-2.5 text-sm";
export function Field({ label, children }: { label: string; children: ReactNode }) { return <label className="block text-sm">{label}{children}</label>; }
export function CurrencySelect({ name = "currency", value, onChange, optional = false }: { name?: string; value: string; onChange: (value: string) => void; optional?: boolean }) {
  return <select name={name} value={value} onChange={event => onChange(event.target.value)} className={tradeField} required={!optional}>{optional ? <option value="">不做折算</option> : null}{Object.keys(CURRENCIES).map(code => <option key={code} value={code}>{code}</option>)}</select>;
}
export function Lookup({ label, kind, selected, onSelect, orderId = "", partyId = "", direction = "", endpoint = "/api/finance/trade/lookup", receiptId = "", materialId = "", bookId = "" }: { label: string; kind: string; selected: TradeOption | null; onSelect: (value: TradeOption | null) => void; orderId?: string; partyId?: string; direction?: string; endpoint?: string; receiptId?: string; materialId?:string; bookId?:string }) {
  const id = useId(), [query, setQuery] = useState(""), [open, setOpen] = useState(!selected), [rows, setRows] = useState<TradeOption[]>([]), [error, setError] = useState(""), [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setLoading(true); setError("");
      const params = new URLSearchParams({ kind, q: query, orderId, partyId, direction, receiptId, materialId, bookId });
      fetch(`${endpoint}?${params}`, { signal: controller.signal, cache: "no-store" }).then(async response => {
        const data = await response.json(); if (!response.ok) throw new Error(data.error ?? "查找失败");
        if (!controller.signal.aborted) setRows(data.rows);
      }).catch(error => { if (!controller.signal.aborted) { setRows([]); setError(error instanceof Error ? error.message : "查找失败"); } }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    }, 200);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [query, kind, orderId, partyId, direction, receiptId, materialId, bookId, endpoint, open]);
  return <div className="space-y-1 text-sm"><label htmlFor={id}>{label}</label><div className="flex gap-2"><input id={id} aria-controls={`${id}-options`} aria-expanded={open} role="combobox" autoComplete="off" className={tradeField} value={selected && !open ? selected.label : query} placeholder="输入关键词查找，点选一条记录" maxLength={100} onFocus={() => setOpen(true)} onChange={event => { setQuery(event.target.value); onSelect(null); setOpen(true); }} /><button type="button" className="mt-1 shrink-0 px-2 text-xs text-[var(--brand-strong)]" onClick={() => { setOpen(!open); setQuery(""); }}>{open ? "收起" : "重选"}</button></div>
    {open ? <div id={`${id}-options`} role="listbox" aria-label={`${label}候选`} className="max-h-40 overflow-y-auto rounded-xl border border-[var(--line)] bg-[var(--menu-bg)]">{rows.map(row => <button type="button" role="option" aria-selected={selected?.id === row.id} key={row.id} className="block w-full px-3 py-2 text-left text-sm hover:bg-[var(--menu-hover)]" onClick={() => { onSelect(row); setOpen(false); setQuery(""); }}>{row.label}</button>)}{loading ? <p className="p-3 text-xs">查找中…</p> : !rows.length ? <p className="p-3 text-xs text-[var(--ink-muted)]">{error || "没有匹配记录，请调整关键词。"}</p> : <p className="border-t border-[var(--line)] p-2 text-xs text-[var(--ink-muted)]">最多20条，可输入关键词缩小范围</p>}</div> : null}
  </div>;
}
export function useTradeCommand(endpoint = "/api/finance/trade") {
  const router = useRouter(), ref = useRef<{ fingerprint: string; key: string } | null>(null);
  const [pending, setPending] = useState(false), [message, setMessage] = useState(""), [result, setResult] = useState<{ id: string; summary: string } | null>(null);
  async function submit(event: FormEvent<HTMLFormElement>, extra: Record<string, unknown>) {
    event.preventDefault(); if (pending || result) return;
    setPending(true); setMessage("");
    const fields = new FormData(event.currentTarget), values: Record<string, unknown> = {};
    for (const [name, value] of fields.entries()) if (typeof value === "string") values[name] = value;
    const command = { ...values, ...extra }, file = fields.get("file");
    const fingerprint = JSON.stringify([command, file instanceof File ? [file.name, file.size, file.lastModified] : null]);
    if (ref.current?.fingerprint !== fingerprint) ref.current = { fingerprint, key: crypto.randomUUID() };
    const body = JSON.stringify({ ...command, idempotencyKey: ref.current.key });
    try {
      let response: Response;
      if (file instanceof File && file.size) { const multipart = new FormData(); multipart.set("command", body); multipart.set("file", file); response = await fetch(endpoint, { method: "POST", body: multipart }); }
      else response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body });
      const data = await response.json(); if (!response.ok) throw new Error(data.error ?? "保存失败");
      setResult(data); setMessage(data.summary); router.refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : "结果未确认，请重试同一请求"); }
    finally { setPending(false); }
  }
  return { submit, pending, message, result };
}
export function FormResult({ state, label, disabled = false, href }: { state: ReturnType<typeof useTradeCommand>; label: string; disabled?: boolean; href?: string }) {
  return <div className="space-y-3"><Button type="submit" disabled={disabled || state.pending || !!state.result}>{state.pending ? "保存中…" : state.result ? "已保存" : label}</Button>{state.message ? <p role="status" className={`text-sm leading-6 ${state.result ? "text-[var(--brand-strong)]" : "text-[var(--danger)]"}`}>{state.message}</p> : null}{state.result && href ? <Link href={href.replace(":id", state.result.id)} className="block text-sm text-[var(--brand-strong)]">查看记录 →</Link> : null}</div>;
}
