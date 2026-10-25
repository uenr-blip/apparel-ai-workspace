import { AttachmentThumbnail } from "@/components/attachment-thumbnail";
import Link from "next/link";
import { BridgePanel } from "../../bridge-panel";
import { notFound } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { TradeError } from "@/lib/trade-money";
import { Card, Badge } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { CatalogCompose } from "@/components/catalog-compose";
import { getTradeContract, listTradeBills, listTradeDocuments } from "@/server/services/trade-read";
import { tradePermissions } from "@/server/services/trade-db";
import { TRADE_MODES, DOC_KINDS } from "@/server/services/trade-contract";
import { BillForm, ContractForm, DocumentForm } from "../../trade-forms";
import { TradeBillsTable } from "../../trade-panels";

export default async function TradeOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession(), { id } = await params;
  const actor = { organizationId: session.organizationId, userId: session.id, role: session.role, factoryId: session.factoryId }, permissions = await tradePermissions(actor);
  if (!permissions.has("trade_view")) return <PageHeader title="外贸订单结算" description="当前账号没有外贸财务查阅权限，请经理在设置中下发。" />;
  let detail;
  try { detail = await getTradeContract(actor, id); } catch (error) { if (error instanceof TradeError && error.status === 404) notFound(); throw error; }
  const [bills, documents] = await Promise.all([listTradeBills(actor, { orderId: id, direction: "receivable" }), listTradeDocuments(actor, { orderId: id })]);
  const fixedOrder = { id, label: `${detail.order.orderNo} · ${detail.order.customerName}` }, contract = detail.contract;
  return <div className="min-w-0 space-y-5"><Link href="/finance?tab=receivables" className="text-sm text-[var(--brand-strong)]">← 外贸订单与应收</Link><PageHeader eyebrow="外贸订单 / 结算与单证" title={detail.order.orderNo} description={`${detail.order.customerName} · 客户PO ${detail.order.externalCustomerPo || "未提供"}`} actions={<Link href={`/orders/${id}`} className="text-sm text-[var(--brand-strong)]">查看业务订单 →</Link>} />
    <Card className="space-y-4 p-5"><div className="flex flex-wrap justify-between gap-3"><h3 className="font-semibold">结算条件</h3>{permissions.has("trade_prepare") ? <CatalogCompose label={contract ? "修改结算条件" : "登记结算条件"} title="订单结算条件"><ContractForm detail={detail} /></CatalogCompose> : null}</div>{contract ? <><div className="flex flex-wrap items-center gap-4"><p className="text-2xl font-medium tabular-nums">{contract.currency} {contract.amount}</p><Badge>{TRADE_MODES[contract.tradeMode as keyof typeof TRADE_MODES] ?? contract.tradeMode}</Badge><span className="text-sm">{contract.incoterm || "贸易术语待确认"}</span></div><p className="text-sm">已登记应收计划 {contract.currency} {contract.plannedAmount} · 待拆分 {contract.unplannedAmount}</p><p className="whitespace-pre-wrap text-sm leading-7 text-[var(--ink-muted)]">{contract.terms}</p></> : <p className="text-sm text-[var(--ink-muted)]">尚未登记本单合同金额与收款条款。请先填写，再拆分各期应收计划。</p>}</Card>
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="font-semibold">应收计划</h3><p className="mt-1 text-xs text-[var(--ink-muted)]">共{bills.total}条，展示前20条；确认后计入业务应收。</p></div>{contract && permissions.has("trade_prepare") ? <CatalogCompose label="新增本单应收" title="本单应收计划"><BillForm direction="receivable" order={fixedOrder} defaultCurrency={contract.currency} /></CatalogCompose> : null}</div><TradeBillsTable rows={bills.rows} /><Link href={`/finance?tab=receivables&view=bills&orderId=${encodeURIComponent(id)}`} className="block text-sm text-[var(--brand-strong)]">筛选与查阅本单全部应收 →</Link>
    <BridgePanel actor={actor} filter={{orderId:id}} compact />
    <Card className="space-y-4 p-5"><div className="flex flex-wrap items-center justify-between gap-3"><h3 className="font-semibold">订单单证</h3>{permissions.has("trade_prepare") ? <CatalogCompose label="关联本单单证" title="登记本单单证"><DocumentForm order={fixedOrder} /></CatalogCompose> : null}</div><ul className="divide-y divide-[var(--line)]">{documents.rows.map(doc => <li key={doc.id} className="flex flex-wrap justify-between gap-3 py-3 text-sm"><div>{DOC_KINDS[doc.kind as keyof typeof DOC_KINDS]} · {doc.number}<p className="mt-1 text-xs text-[var(--ink-muted)]">{doc.issuedOn}</p></div>{doc.filename ? <AttachmentThumbnail href={`/api/finance/trade/documents/${doc.id}/file?preview=1`} name={doc.filename} /> : <Badge tone="warning">待补原文件</Badge>}</li>)}</ul>{!documents.rows.length ? <p className="text-sm text-[var(--ink-muted)]">尚无已登记单证，不自动推定报关或发票已经完成。</p> : null}<Link href={`/finance?tab=documents&orderId=${encodeURIComponent(id)}`} className="block text-sm text-[var(--brand-strong)]">查阅与补充本单全部单证 →</Link></Card>
  </div>;
}
