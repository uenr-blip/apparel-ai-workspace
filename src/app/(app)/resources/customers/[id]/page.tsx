import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { TradeError } from "@/lib/trade-money";
import { getPartnerDossier } from "@/server/services/partner-dossier";
import { PartnerDossier } from "@/components/partner-dossier";
import { PageHeader } from "@/components/ui/page-header";
import { BusinessAgentEntry } from "@/components/business-agent-entry";
export default async function CustomerPage({params,searchParams}:{params:Promise<{id:string}>;searchParams:Promise<{group?:string;page?:string;brand?:string}>}) {
 const session=await requireSession(),{id}=await params,q=await searchParams;
 let data;try{data=await getPartnerDossier({organizationId:session.organizationId,userId:session.id,role:session.role,factoryId:session.factoryId},"customer",id,{group:q.group,page:Number(q.page),brandId:q.brand});}catch(e){if(e instanceof TradeError&&[403,404].includes(e.status))notFound();throw e;}
 return <div className="space-y-5"><PageHeader eyebrow={`客户 · ${data.partner.code}`} title={data.partner.name} description="在做什么、卡在哪里、以前做过什么，都从原记录核对。" actions={<><BusinessAgentEntry module="workspace" initialText={`查客户 ${data.partner.code} ${data.partner.name} 的在做订单、品牌和历史记录`}/><Link className="text-sm underline" href="/resources?view=partners&partnerKind=customer">返回客户列表</Link></>}/><PartnerDossier data={data} path={`/resources/customers/${id}`}/></div>;
}
