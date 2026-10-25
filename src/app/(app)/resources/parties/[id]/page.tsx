import { listFactoryTransfers } from "@/server/services/factory-transfer";
import { FactoryTransferRecords } from "@/components/factory-transfer-records";
import { TradeError } from "@/lib/trade-money";
import { getPartnerDossier } from "@/server/services/partner-dossier";
import { PartnerDossier } from "@/components/partner-dossier";
import { BusinessAgentEntry } from "@/components/business-agent-entry";
import { notFound } from "next/navigation";
import Link from "next/link";
import { requireSession } from "@/lib/auth";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { getPartyRecord, ResourceRecordError } from "@/server/services/resource-records";

export default async function PartyDetailPage({ params,searchParams }: { params: Promise<{ id: string }>; searchParams:Promise<{group?:string;page?:string;receiptPage?:string;samplePage?:string}> }) {
  const session = await requireSession();
  const { id } = await params;
  let record;
  try {
    record = await getPartyRecord(session.organizationId, id, session);
  } catch (error) {
    if (error instanceof ResourceRecordError) notFound();
    throw error;
  }

  const q=await searchParams;
  let dossier:Awaited<ReturnType<typeof getPartnerDossier>>|null=null;
  let scopeNote="";
  if(record.kind==="factory"||record.kind==="supplier") {
    try {dossier=await getPartnerDossier({organizationId:session.organizationId,userId:session.id,role:session.role,factoryId:session.factoryId},record.kind,id,{group:q.group,page:Number(q.page),receiptPage:Number(q.receiptPage),samplePage:Number(q.samplePage)});}
    catch(e){if(e instanceof TradeError&&e.status===403)scopeNote="供料与关联订单沿用材料凭证的查看权限；当前账号尚无此权限，不能据此判断没有业务。";else throw e;}
  }
  const transfers = record.kind === "factory" && ["manager", "salesperson", "factory"].includes(session.role) ? await listFactoryTransfers({ organizationId: session.organizationId, userId: session.id, role: session.role, factoryId: session.factoryId }, { factoryId: id }) : [];
  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow={record.kindLabel}
        title={record.name}
        actions={session.role!=="factory" ? <BusinessAgentEntry module="workspace" initialText={`查 ${record.code} ${record.name} 的当前业务、进度和历史记录`}/> : undefined}
        description={
          <>
            {record.code} · 从原订单、打样和供料凭证查看当前与历史。{" "}
            <Link href="/resources?view=partners" className="text-[var(--brand-strong)]">
              返回往来单位
            </Link>
          </>
        }
      />
      {record.demoNote ? <p className="text-sm text-[var(--ink-muted)]">{record.demoNote}</p> : null}
      {scopeNote && <p className="text-sm text-[var(--ink-muted)]">{scopeNote}</p>}
      {transfers.length ? <Card className="p-4"><h2 className="mb-3 font-medium">本厂转出与接收记录</h2><FactoryTransferRecords records={transfers} /></Card> : null}
      {dossier && <PartnerDossier data={dossier} path={`/resources/parties/${id}`}/>}
      <details className="rounded-xl border border-[var(--line)] p-4"><summary className="cursor-pointer text-sm">地点批次与历史报价</summary><div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card className="p-5 text-sm">
          <h3 className="font-medium">这个地点的批次</h3>
          <ul className="mt-3 space-y-2">
            {record.lots.length === 0 ? <li className="text-[var(--ink-muted)]">这个地点还没有批次</li> : null}
            {record.lots.map((lot) => (
              <li key={lot.id}>
                <Link href={`/resources/lots/${lot.id}`} className="text-[var(--brand-strong)]">
                  {lot.materialCode} {lot.colorName}
                </Link>
                <span className="text-[var(--ink-muted)]">
                  {" "}
                  在手 {lot.qtyOnHand} / 占用 {lot.qtyAllocated}
                  {lot.inboundEta ? ` · ETA ${lot.inboundEta}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </Card>
        <Card className="p-5 text-sm">
          <h3 className="font-medium">报价</h3>
          <ul className="mt-3 space-y-2">
            {record.quotes.length === 0 ? <li className="text-[var(--ink-muted)]">还没有报价</li> : null}
            {record.quotes.map((quote) => (
              <li key={quote.id}>
                <Link href={`/resources/quotes/${quote.id}`} className="text-[var(--brand-strong)]">
                  {quote.materialCode} {quote.unitPriceYuan} 元/{quote.unit}
                </Link>
                <span className="ml-2 text-[var(--warning)]">历史报价</span>
              </li>
            ))}
          </ul>
        </Card>

      </div></details>
    </div>
  );
}
