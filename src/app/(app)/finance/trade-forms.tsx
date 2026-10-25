"use client";
import { useState } from "react";
import { BILL_CATEGORIES, DOC_KINDS, TRADE_MODES } from "@/server/services/trade-contract";
import type { TradeOption } from "@/server/services/trade-lookup";
import type { getTradeBill, getTradeContract } from "@/server/services/trade-read";
import { convertMoney, formatMoney, parseMoney } from "@/lib/trade-money";
import { FileWell } from "@/components/file-well";
import { CurrencySelect, Field, FormResult, Lookup, tradeField, useTradeCommand } from "./trade-form-parts";

export function ContractForm({ detail }: { detail?: Awaited<ReturnType<typeof getTradeContract>> }) {
  const state = useTradeCommand(), [order, setOrder] = useState<TradeOption | null>(detail ? { id: detail.order.id, label: detail.order.orderNo } : null), [currency, setCurrency] = useState(detail?.contract?.currency ?? "USD");
  return <form className="space-y-4" onSubmit={event => void state.submit(event, { action: "save_contract", orderId: order?.id, expectedVersion: detail?.contract?.version ?? 0 })}>
    {detail ? <p className="text-sm">{detail.order.orderNo} · {detail.order.customerName}</p> : <Lookup label="关联业务订单" kind="orders" selected={order} onSelect={setOrder} />}
    <div className="grid gap-4 sm:grid-cols-2"><Field label="合同币种"><CurrencySelect value={currency} onChange={setCurrency} /></Field><Field label="本单合同金额"><input name="amount" inputMode="decimal" required maxLength={32} defaultValue={detail?.contract?.amount ?? ""} className={tradeField} /></Field></div>
    <Field label="出口模式"><select name="tradeMode" defaultValue={detail?.contract?.tradeMode ?? "unknown"} className={tradeField}>{Object.entries(TRADE_MODES).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></Field>
    <Field label="贸易术语及约定地点（可空）"><input name="incoterm" maxLength={80} defaultValue={detail?.contract?.incoterm ?? ""} placeholder="例如 FOB + 约定港口；未确认可留空" className={tradeField} /></Field>
    <Field label="收款条款与确认依据"><textarea name="terms" required maxLength={2000} rows={3} defaultValue={detail?.contract?.terms ?? ""} placeholder="填写真实约定，不默认订金比例或账期" className={tradeField} /></Field>
    <FormResult state={state} label="保存结算条件" disabled={!order} href={order ? `/finance/orders/${order.id}` : undefined} />
  </form>;
}

export function BillForm({ direction, order: fixedOrder, defaultCurrency = "USD", receipt }: { direction: "receivable" | "payable"; order?: TradeOption; defaultCurrency?: string; receipt?: TradeOption & {partyLabel?:string} }) {
  const state = useTradeCommand(), [order, setOrder] = useState<TradeOption | null>(fixedOrder ?? null), [party, setParty] = useState<TradeOption | null>(receipt?.partyId ? {id:receipt.partyId,label:receipt.partyLabel??"\u4f9b\u8d27\u65b9"}:null), [source, setSource] = useState<TradeOption | null>(receipt??null), [packing, setPacking] = useState<TradeOption | null>(null);
  const [currency, setCurrency] = useState(defaultCurrency), [amount, setAmount] = useState(receipt?.amount??""), [sourceKind, setSourceKind] = useState(receipt?"receipt":"manual");
  const receive = direction === "receivable";
  return <form className="space-y-4" onSubmit={event => void state.submit(event, { action: "create_bill", orderId: order?.id, direction, partyId: party?.id ?? "", sourceKind, sourceId: source?.id ?? "", packingPlanId: packing?.id ?? "" })}>
    {fixedOrder ? <p className="text-sm">{fixedOrder.label}</p> : <Lookup label="关联订单" kind="orders" selected={order} onSelect={value => { setOrder(value); setSource(null); setPacking(null); }} />}
    {!receive ? <Lookup label="结算供应商或工厂" kind="parties" selected={party} onSelect={setParty} /> : <p className="text-xs leading-5 text-[var(--ink-muted)]">客户取自本单。请先登记订单结算条件，各期应收总额不能超过合同金额。</p>}
    <div className="grid gap-4 sm:grid-cols-2"><Field label="款项名称"><input name="title" required maxLength={120} placeholder={receive ? "例如 首期订金" : "例如 九月加工款"} className={tradeField} /></Field><Field label="款项类型"><select name="category" defaultValue={receive ? "deposit" : receipt ? "materials" : "processing"} className={tradeField}>{Object.entries(BILL_CATEGORIES).filter(([key]) => !receive || ["deposit", "balance", "shipment", "other"].includes(key)).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></Field></div>
    {!receive ? <><Field label="金额来源"><select value={sourceKind} onChange={event => { setSourceKind(event.target.value); setSource(null); }} className={tradeField}><option value="manual">按实际依据手工登记</option><option value="recon">引用工厂加工草稿</option><option value="receipt">引用实际收料凭证</option><option value="purchase">引用采购草稿</option></select></Field>{sourceKind !== "manual" && order ? <Lookup label="选择来源草稿" kind={sourceKind === "recon" ? "recons" : sourceKind === "receipt" ? "receipts" : "purchases"} orderId={order.id} selected={source} onSelect={value => { setSource(value); if (value) { setCurrency(value.currency ?? "CNY"); setAmount(value.amount ?? ""); } }} /> : null}</> : null}
    <div className="grid gap-4 sm:grid-cols-2"><Field label="币种"><CurrencySelect value={currency} onChange={setCurrency} /></Field><Field label="本期金额"><input name="amount" inputMode="decimal" required maxLength={32} value={amount} onChange={event => setAmount(event.target.value)} className={tradeField} /></Field></div>
    <Field label="约定到期日"><input name="dueDate" type="date" required className={tradeField} /></Field><Field label="核对依据"><textarea name="basis" rows={3} required maxLength={2000} placeholder="合同、报价、约定等；引用草稿仍需独立确认" className={tradeField} /></Field>
    {order ? <details><summary className="cursor-pointer text-sm">关联已出运批次（可选）</summary><div className="mt-3"><Lookup label="已出运批次" kind="packing" orderId={order.id} selected={packing} onSelect={setPacking} /></div></details> : null}
    <FormResult state={state} label={`登记${receive ? "应收" : "应付"}草稿`} disabled={!order || (!receive && !party) || (sourceKind !== "manual" && !source)} href="/finance/bills/:id" />
  </form>;
}

export function CashForm() {
  const state = useTradeCommand(), [direction, setDirection] = useState("receive"), [party, setParty] = useState<TradeOption | null>(null), [currency, setCurrency] = useState("USD"), [baseCurrency, setBaseCurrency] = useState("");
  return <form className="space-y-4" onSubmit={event => void state.submit(event, { action: "record_cash", direction, partyId: party?.id })}>
    <p className="rounded-xl bg-[var(--paper)] p-3 text-sm leading-6">登记银行已经发生的收付款，用于核对与核销。保存不会发起转账。</p>
    <Field label="流水方向"><select value={direction} onChange={event => { setDirection(event.target.value); setParty(null); }} className={tradeField}><option value="receive">客户收款</option><option value="pay">供应商 / 工厂付款</option></select></Field>
    <Lookup key={direction} label="往来方" kind={direction === "receive" ? "customers" : "parties"} selected={party} onSelect={setParty} />
    <div className="grid gap-4 sm:grid-cols-2"><Field label="流水币种"><CurrencySelect value={currency} onChange={setCurrency} /></Field><Field label="款项本金"><input name="amount" inputMode="decimal" required maxLength={32} className={tradeField} /></Field></div>
    <Field label={`本次银行手续费（${currency}）`}><input name="fee" defaultValue="0" inputMode="decimal" required maxLength={32} className={tradeField} /></Field>
    <p className="text-xs leading-6 text-[var(--ink-muted)]">{direction === "receive" ? "银行净到账 = 款项本金 − 本方承担的手续费。客户少付的本金不能直接当成手续费。" : "银行实际支出 = 款项本金 + 本方承担的手续费。"}核销分配以款项本金为上限。</p>
    <div className="grid gap-4 sm:grid-cols-2"><Field label="本方账户名称 / 尾号"><input name="bankAccount" required maxLength={100} placeholder="例如 美元结算户 · 尾号1234" className={tradeField} /></Field><Field label="银行流水号"><input name="bankReference" required maxLength={120} className={tradeField} /></Field></div>
    <Field label="实际发生日"><input name="occurredOn" type="date" required className={tradeField} /></Field><Field label="登记依据"><textarea name="basis" required rows={2} maxLength={2000} placeholder="银行回单、客户付款通知及核对情况" className={tradeField} /></Field>
    <details><summary className="cursor-pointer text-sm">保留折算参考（可选）</summary><div className="mt-3 space-y-3"><Field label="参考折算币种"><CurrencySelect name="baseCurrency" value={baseCurrency} onChange={setBaseCurrency} optional /></Field>{baseCurrency ? <><Field label={`1 ${currency} = 多少 ${baseCurrency}`}><input name="exchangeRate" required inputMode="decimal" maxLength={32} className={tradeField} /></Field><Field label="汇率日期"><input name="rateDate" type="date" required className={tradeField} /></Field><Field label="汇率来源"><input name="rateSource" required maxLength={500} className={tradeField} /></Field><p className="text-xs text-[var(--ink-muted)]">保存款项本金的折算参考，不自动确认汇兑损益或总账。</p></> : null}</div></details>
    <FormResult state={state} label="保存已发生流水" disabled={!party} />
  </form>;
}

export function AllocationForm({ bill }: { bill: Awaited<ReturnType<typeof getTradeBill>> }) {
  const state = useTradeCommand(), [cash, setCash] = useState<TradeOption | null>(null), [amount, setAmount] = useState(""), [rate, setRate] = useState("");
  const cross = cash && cash.currency !== bill.currency;
  let preview = "—";
  try { if (cash?.currency && amount) preview = formatMoney(convertMoney(parseMoney(amount, cash.currency), cash.currency, bill.currency, cross ? rate : "1"), bill.currency); } catch { /* Input may be incomplete while typing. Server repeats validation. */ }
  return <form className="space-y-4" onSubmit={event => void state.submit(event, { action: "allocate", billId: bill.id, cashId: cash?.id, expectedBillVersion: bill.version, expectedCashVersion: cash?.version, cashAmount: amount, exchangeRate: cross ? rate : "1" })}>
    <p className="text-sm leading-6">{bill.orderNo} · {bill.title} · {bill.partyName}<br />单据余额：{bill.currency} {bill.openAmount}</p>
    <Lookup label="选择可分配流水" kind="cash" partyId={bill.partyId} direction={bill.direction === "receivable" ? "receive" : "pay"} selected={cash} onSelect={value => { setCash(value); setAmount(""); setRate(""); }} />
    <Field label={`使用流水金额${cash?.currency ? `（${cash.currency}）` : ""}`}><input inputMode="decimal" required maxLength={32} value={amount} onChange={event => setAmount(event.target.value)} className={tradeField} /></Field>
    {cross ? <><Field label={`核销汇率：1 ${cash.currency} = 多少 ${bill.currency}`}><input inputMode="decimal" required maxLength={32} value={rate} onChange={event => setRate(event.target.value)} className={tradeField} /></Field><Field label="汇率日期"><input name="rateDate" type="date" required className={tradeField} /></Field><Field label="本次核销汇率依据"><input name="rateSource" required maxLength={500} className={tradeField} /></Field></> : null}
    <p className="rounded-xl bg-[var(--paper)] p-3 text-sm">本次抵扣单据：{bill.currency} <strong>{preview}</strong>。{cross ? "按单据币种精度四舍五入，并保留两边金额。" : "同币种按原金额分配。"}</p>
    <FormResult state={state} label="确认核销分配" disabled={!cash || preview === "—"} />
  </form>;
}

export function RecordActionForm({ action, id, version, label, explanation, adjustmentCurrency }: { action: string; id: string; version?: number; label: string; explanation?: string; adjustmentCurrency?: string }) {
  const state = useTradeCommand(), needsReason = action !== "confirm_bill";
  return <form className="space-y-4" onSubmit={event => void state.submit(event, { action, id, ...(version === undefined ? {} : { expectedVersion: version }) })}>
    {explanation ? <p className="text-sm leading-6">{explanation}</p> : null}
    {adjustmentCurrency ? <Field label={`扣补金额（${adjustmentCurrency}；扣款填负数，补款填正数）`}><input name="amount" inputMode="decimal" required maxLength={32} className={tradeField} /></Field> : null}
    {needsReason ? <Field label="原因与依据"><textarea name="reason" rows={3} required maxLength={2000} className={tradeField} /></Field> : null}
    <FormResult state={state} label={label} />
  </form>;
}

export function DocumentForm({ order: fixedOrder, fixedBill }: { order?: TradeOption; fixedBill?: { id: string; label: string; orderId: string | null } }) {
  const state = useTradeCommand(), [order, setOrder] = useState<TradeOption | null>(fixedOrder ?? null), [bill, setBill] = useState<TradeOption | null>(null), [packing, setPacking] = useState<TradeOption | null>(null), [cash, setCash] = useState<TradeOption | null>(null);
  return <form className="space-y-4" onSubmit={event => void state.submit(event, { action: "add_document", orderId: fixedBill?.orderId ?? order?.id ?? "", billId: fixedBill?.id ?? bill?.id ?? "", cashId: cash?.id ?? "", packingPlanId: packing?.id ?? "" })}>
    {fixedBill ? <p className="text-sm">{fixedBill.label}</p> : fixedOrder ? <p className="text-sm">{fixedOrder.label}</p> : <Lookup label="单证所属订单" kind="orders" selected={order} onSelect={value => { setOrder(value); setBill(null); setCash(null); setPacking(null); }} />}
    <Field label="单证类型"><select name="kind" className={tradeField}>{Object.entries(DOC_KINDS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></Field>
    <Field label="单证编号 / 内部识别号"><input name="number" required maxLength={120} className={tradeField} /></Field><Field label="单证日期"><input name="issuedOn" type="date" required className={tradeField} /></Field>
    <FileWell label="原文件" hint="可后补，PDF / JPG / PNG，最多 8MB" accept="application/pdf,image/png,image/jpeg" />
    {order ? <details><summary className="cursor-pointer text-sm">关联应收应付、收付流水或出运批次</summary><div className="mt-3 space-y-3"><Lookup label="关联业务单据" kind="bills" orderId={order.id} selected={bill} onSelect={value => { setBill(value); setCash(null); }} />{bill ? <Lookup label="关联收付流水" kind="cash_records" partyId={bill.partyId} direction={bill.direction === "receivable" ? "receive" : "pay"} selected={cash} onSelect={setCash} /> : <p className="text-xs text-[var(--ink-muted)]">先选择单据，可继续关联对应往来方的流水。</p>}<Lookup label="关联已出运批次" kind="packing" orderId={order.id} selected={packing} onSelect={setPacking} /></div></details> : null}
    <Field label="备注"><textarea name="note" rows={2} maxLength={2000} className={tradeField} /></Field><FormResult state={state} label="登记单证" disabled={!order && !fixedBill} />
  </form>;
}

export function AttachDocumentForm({ id }: { id: string }) {
  const state = useTradeCommand();
  return <form className="space-y-4" onSubmit={event => void state.submit(event, { action: "attach_document", id })}><FileWell label="补充原文件" hint="PDF / JPG / PNG，最多 8MB" accept="application/pdf,image/png,image/jpeg" required /><FormResult state={state} label="保存原文件" /></form>;
}
