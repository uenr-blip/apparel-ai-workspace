import Link from "next/link";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/ui/page-header";
import { AgentResultTable } from "@/components/agent-result-table";
import { authorizePattern } from "@/server/services/pattern-workflow";
import type { TradeActor } from "@/server/services/trade-contract";

export async function FactoryPatternInbox({actor}:{actor:TradeActor}) {
  await authorizePattern(actor,prisma,true);
  if (actor.role !== "factory" || !actor.factoryId) return null;
  const samples=await prisma.patternSample.findMany({where:{factoryId:actor.factoryId,issuedAt:{not:null},project:{organizationId:actor.organizationId}},select:{id:true,projectId:true,round:true,quantity:true,dueDate:true,receivedAt:true,revision:{select:{number:true}},project:{select:{code:true,name:true}}},orderBy:{issuedAt:"desc"},take:100});
  return <div className="space-y-5"><PageHeader title="本厂打样要求" description="打开指定版次，核对完整要求后确认收到。" actions={<Link className="underline text-sm" href="/workspace">返回工作台</Link>}/><AgentResultTable table={{title:"已向本厂发出的打样要求",columns:["开发款式","版次 / 轮次","件数","预计回样","交接"],rows:samples.map(s=>({href:`/projects/${s.projectId}/samples/${s.id}`,cells:[`${s.project.code} ${s.project.name}`,`V${s.revision.number} / 第${s.round}次`,s.quantity,s.dueDate||"待确认",s.receivedAt?"已确认收到":"待确认收到"]})),emptyMessage:"本厂暂未收到打样要求",notes:samples.length===100?["仅列最近100条，请联系负责人核对更早记录"]:[]}}/></div>;
}
