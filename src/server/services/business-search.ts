import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { TradeError } from "@/lib/trade-money";
import { SEARCH_KINDS, searchQuery, type SearchKind, type SearchItem, type SearchResult } from "@/lib/business-search";
import type { TradeActor } from "./trade-contract";

export async function authorizeBusinessRead(actor:TradeActor) {
  const user=await prisma.user.findFirst({where:{id:actor.userId,organizationId:actor.organizationId,active:true,role:actor.role},select:{factoryId:true}});
  if(!user || !["manager","salesperson","factory"].includes(actor.role) || actor.role==="factory" && (!user.factoryId || user.factoryId!==actor.factoryId)) throw new TradeError("当前账号无权查阅这些业务资料",403);
}
function sourceSql(actor:TradeActor) {
  const org=actor.organizationId, factory=actor.role==="factory",fid=actor.factoryId || "";
  return Prisma.sql`
    SELECT s.id,'style' kind,s.code,s.name,COALESCE(s.category,'')||' '||COALESCE(b.name,'')||' '||COALESCE((SELECT group_concat(a.code,' ') FROM StyleCodeAlias a WHERE a.styleId=s.id AND a.organizationId=s.organizationId),'') detail FROM Style s LEFT JOIN StyleOption b ON b.id=s.brandOptionId AND b.organizationId=s.organizationId
    WHERE s.archivedAt IS NULL AND s.organizationId=${org} ${factory?Prisma.sql`AND EXISTS(SELECT 1 FROM OrderLine l JOIN SalesOrder o ON o.id=l.orderId WHERE l.styleId=s.id AND o.organizationId=${org} AND o.factoryId=${fid})`:Prisma.empty}
    UNION ALL SELECT p.id,'project',p.code,p.name,CASE p.craftFamily WHEN 'sweater' THEN '毛衣' WHEN 'knit' THEN '针织' WHEN 'woven' THEN '梭织' ELSE '' END FROM DevelopmentProject p WHERE p.archivedAt IS NULL AND p.organizationId=${org}
    ${factory?Prisma.sql`AND EXISTS(SELECT 1 FROM PatternSample x WHERE x.projectId=p.id AND x.factoryId=${fid} AND x.issuedAt IS NOT NULL)`:Prisma.empty}
    UNION ALL SELECT m.id,'material',m.code,m.name,m.kind||' '||m.unit||' '||m.composition||' '||m.specSummary FROM Material m WHERE m.archivedAt IS NULL AND m.organizationId=${org}
    ${factory?Prisma.sql`AND EXISTS(SELECT 1 FROM InventoryLot l WHERE l.materialId=m.id AND l.organizationId=${org} AND l.locationId=${fid})`:Prisma.empty}
    UNION ALL SELECT o.id,'order',o.orderNo,COALESCE(c.name,''),COALESCE(o.externalCustomerPo,'')||' '||COALESCE((SELECT group_concat(s.code||' '||s.name,' ') FROM OrderLine l JOIN Style s ON s.id=l.styleId AND s.organizationId=o.organizationId WHERE l.orderId=o.id),'') FROM SalesOrder o JOIN Customer c ON c.id=o.customerId AND c.organizationId=o.organizationId WHERE o.archivedAt IS NULL AND o.organizationId=${org} ${factory?Prisma.sql`AND o.factoryId=${fid}`:Prisma.empty}
    UNION ALL SELECT c.id,'customer',c.code,c.name,'' FROM Customer c WHERE c.archivedAt IS NULL AND c.organizationId=${org} ${factory?Prisma.sql`AND 0`:Prisma.empty}
    UNION ALL SELECT p.id,p.kind,p.code,p.name,'' FROM Party p WHERE p.archivedAt IS NULL AND p.organizationId=${org} AND p.kind IN ('factory','supplier') ${factory?Prisma.sql`AND p.id=${fid} AND p.kind='factory'`:Prisma.empty}`;
}
const href=(kind:SearchKind,id:string)=>`${({style:"/styles/",project:"/projects/",material:"/resources/materials/",order:"/orders/",customer:"/resources/customers/",factory:"/resources/parties/",supplier:"/resources/parties/"})[kind]}${encodeURIComponent(id)}`;
export async function searchBusiness(actor:TradeActor,raw:unknown,options:{kind?:SearchKind;page?:number;suggest?:boolean;allowEmpty?:boolean}={}):Promise<SearchResult> {
  await authorizeBusinessRead(actor);
  const query=searchQuery(raw),pageSize=options.suggest?6:20;
  if(!query&&!options.allowEmpty)return{query,items:[],counts:{},total:0,page:1,pageSize,pageCount:1};
  const words=query.split(/\s+/).filter(Boolean).slice(0,8);
  const terms=words.length?Prisma.join(words.map(w=>Prisma.sql`instr(lower(code||' '||name||' '||detail),lower(${w}))>0`)," AND "):Prisma.sql`1=1`;
  const base=Prisma.sql`WITH candidates AS (${sourceSql(actor)}), matched AS (SELECT * FROM candidates WHERE ${terms})`;
  const counts=await prisma.$queryRaw<Array<{kind:SearchKind;n:bigint}>>(Prisma.sql`${base} SELECT kind,COUNT(*) n FROM matched GROUP BY kind`);
  const kind=options.kind&&SEARCH_KINDS.includes(options.kind)?options.kind:undefined;
  const total=counts.filter(r=>!kind||r.kind===kind).reduce((n,r)=>n+Number(r.n),0),pageCount=Math.max(1,Math.ceil(total/pageSize));
  const page=Math.min(pageCount,Math.max(1,Math.floor(Number(options.page)||1)));
  const rank=Prisma.sql`CASE WHEN lower(code)=lower(${query}) OR lower(name)=lower(${query}) THEN 0 WHEN instr(lower(code),lower(${query}))=1 OR instr(lower(name),lower(${query}))=1 THEN 1 ELSE 2 END`;
  const rows=await prisma.$queryRaw<Array<Omit<SearchItem,"href">>>(options.suggest
    ? Prisma.sql`${base}, ranked AS (SELECT *,ROW_NUMBER() OVER(PARTITION BY kind ORDER BY ${rank},code,id) rn FROM matched) SELECT id,kind,code,name,detail FROM ranked WHERE rn<=6 ORDER BY kind,rn`
    : Prisma.sql`${base} SELECT * FROM matched WHERE ${kind?Prisma.sql`kind=${kind}`:Prisma.sql`1=1`} ORDER BY ${rank},kind,code,id LIMIT ${pageSize} OFFSET ${(page-1)*pageSize}`);
  return{query,items:rows.map(r=>({...r,detail:r.detail.slice(0,240),href:href(r.kind,r.id)})),counts:Object.fromEntries(counts.map(r=>[r.kind,Number(r.n)])),total,page,pageSize,pageCount};
}
