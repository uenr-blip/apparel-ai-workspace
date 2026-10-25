import { createId } from "@/lib/hash";
import { currencyDigits,dateInZone,formatMoney,parseMoney,TradeError,MAX_MINOR } from "@/lib/trade-money";
import { requireVersion,requireTrade,type TradeDb } from "./trade-db";
import type { TradeActor } from "./trade-contract";
import { LedgerCommandSchema,type LedgerCommand,type NextFinancePermission } from "./ledger-contract";
import { financialWrite,ledgerPermissions,ledgerBook,journalRow,journalLines,openPeriod,monthCheck,sourceHash,type BookRow,type JournalRow } from "./ledger-db";
import { buildSourceLines,readLedgerSource } from "./ledger-source";
import { ensureLedgerBusinessSource } from "./ledger-business-check";

const DEMO_ACCOUNTS=[["A-BANK","银行存款（示例）","asset"],["A-AR","应收款（示例）","asset"],["L-AP","应付款（示例）","liability"],["E-EQUITY","期初权益（示例）","equity"],["R-INCOME","收入（示例）","income"],["A-INVENTORY","原材料（示例）","asset"],["X-COST","成本费用（示例）","expense"],["X-FEE","手续费（示例）","expense"],["X-FX","汇兑差额（示例）","expense"]];
const PERMISSIONS:Record<LedgerCommand["action"],NextFinancePermission>={create_book:"ledger_config",create_account:"ledger_config",set_account_active:"ledger_config",add_period:"ledger_close",save_journal:"ledger_prepare",from_source:"ledger_prepare",review_journal:"ledger_review",post_journal:"ledger_post",void_journal:"ledger_prepare",reverse_journal:"ledger_prepare",close_period:"ledger_close",reopen_period:"ledger_close"};
export async function runLedgerCommand(actor:TradeActor,input:unknown){const parsed=LedgerCommandSchema.safeParse(input);if(!parsed.success)throw new TradeError(`请检查总账输入：${parsed.error.issues[0].message}`);return financialWrite(actor,"ledger",parsed.data,PERMISSIONS[parsed.data.action],(db,now)=>execute(db,actor,parsed.data,now));}
async function insertLines(db:TradeDb,book:BookRow,journalId:string,lines:Array<{accountId:string;debit:string;credit:string;note:string}>){
 let number=0;
 for(const line of lines){const [a]=await db.$queryRaw<Array<{id:string;code:string;name:string;active:boolean|bigint}>>`SELECT id,code,name,active FROM GLAccount WHERE bookId=${book.id} AND id=${line.accountId}`;if(!a||!a.active)throw new TradeError("分录科目不属于当前账套或已停用");const debit=parseMoney(line.debit,book.baseCurrency,{zero:true}),credit=parseMoney(line.credit,book.baseCurrency,{zero:true});if((debit>BigInt(0))===(credit>BigInt(0)))throw new TradeError("每行必须且只能填写借方或贷方金额");await db.$executeRaw`INSERT INTO GLLine(id,journalId,accountId,lineNo,accountCode,accountName,debitMinor,creditMinor,note) VALUES(${createId()},${journalId},${a.id},${++number},${a.code},${a.name},${debit},${credit},${line.note})`;}
}
async function validateJournal(db:TradeDb,actor:TradeActor,j:JournalRow){
 const book=await ledgerBook(db,actor.organizationId,j.bookId);await openPeriod(db,book,j.date);const lines=await journalLines(db,j.id);
 if(lines.length<2)throw new TradeError("凭证至少需要两条分录");
 const debit=lines.reduce((sum,l)=>sum+l.debitMinor,BigInt(0)),credit=lines.reduce((sum,l)=>sum+l.creditMinor,BigInt(0));
 if(debit!==credit||debit<=BigInt(0)||debit>MAX_MINOR)throw new TradeError("凭证借贷未平衡或金额超限");
 if(j.expectedTotalMinor!==null&&debit!==j.expectedTotalMinor)throw new TradeError("凭证总额与来源折算金额不一致");
 const invalid=await db.$queryRaw<Array<{id:string}>>`SELECT l.id FROM GLLine l JOIN GLAccount a ON a.id=l.accountId WHERE l.journalId=${j.id} AND (a.bookId<>${book.id} OR a.active=0) LIMIT 1`;if(invalid.length)throw new TradeError("分录科目已变化或停用，请重新核对");
 if(j.sourceType!=="manual"&&j.sourceType!=="reversal"){await ensureLedgerBusinessSource(db,actor,j.sourceType,j.sourceId!);const source=await readLedgerSource(db,actor.organizationId,j.sourceType,j.sourceId!);if(typeof source.facts.occurredOn==="string"&&j.date<source.facts.occurredOn)throw new TradeError("\u5165\u8d26\u65e5\u671f\u65e9\u4e8e\u5b9e\u9645\u6536\u4ed8");if(sourceHash(source.facts)!==j.sourceHash)throw new TradeError("业务来源已变化，请作废草稿后按新依据制单",409);}
 if(j.reversesId){const original=await journalRow(db,actor.organizationId,j.reversesId);if(original.bookId!==book.id||original.status!=="posted"||original.reversedById)throw new TradeError("原凭证不可冲销或已经完成反向过账");if(j.date<original.date)throw new TradeError("反向凭证不能早于原凭证");const old=await journalLines(db,original.id);if(old.length!==lines.length||old.some((l,i)=>l.accountId!==lines[i].accountId||l.debitMinor!==lines[i].creditMinor||l.creditMinor!==lines[i].debitMinor))throw new TradeError("反向凭证必须保持原分录金额和科目");}
 return book;
}
async function execute(db:TradeDb,actor:TradeActor,c:LedgerCommand,now:string):Promise<{id:string;summary:string}>{
 const org=actor.organizationId;
 if(c.action==="create_book"){
  currencyDigits(c.baseCurrency);monthCheck(c.startMonth);const id=createId();
  const duplicate=await db.$queryRaw<Array<{id:string}>>`SELECT id FROM GLBook WHERE organizationId=${org} AND name=${c.name}`;if(duplicate.length)throw new TradeError("账套名称已存在");
  await db.$executeRaw`INSERT INTO GLBook(id,organizationId,name,baseCurrency,startMonth,mode,createdBy,createdAt) VALUES(${id},${org},${c.name},${c.baseCurrency},${c.startMonth},'demo',${actor.userId},${now})`;
  for(const [code,name,category] of DEMO_ACCOUNTS)await db.$executeRaw`INSERT INTO GLAccount(id,bookId,code,name,category,active,createdAt) VALUES(${createId()},${id},${code},${name},${category},1,${now})`;
  const start=new Date(`${c.startMonth}-01T00:00:00Z`);for(let i=0;i<12;i++){const month=new Date(Date.UTC(start.getUTCFullYear(),start.getUTCMonth()+i,1)).toISOString().slice(0,7);monthCheck(month);await db.$executeRaw`INSERT INTO GLPeriod(id,bookId,month,status,nextNumber) VALUES(${createId()},${id},${month},'open',1)`;}
  return {id,summary:`建立演示账套 ${c.name}，示例科目未视为真实企业会计规则`};
 }
 if(c.action==="create_account"||c.action==="set_account_active"||c.action==="add_period"||c.action==="close_period"||c.action==="reopen_period"){
  const book=await ledgerBook(db,org,c.bookId);
  if(c.action==="create_account"){const dup=await db.$queryRaw<Array<{id:string}>>`SELECT id FROM GLAccount WHERE bookId=${book.id} AND code=${c.code}`;if(dup.length)throw new TradeError("科目代码已存在");const id=createId();await db.$executeRaw`INSERT INTO GLAccount(id,bookId,code,name,category,active,createdAt) VALUES(${id},${book.id},${c.code},${c.name},${c.category},1,${now})`;return{id:book.id,summary:`新增账套科目 ${c.code} ${c.name}`};}
  if(c.action==="set_account_active"){const changed=await db.$executeRaw`UPDATE GLAccount SET active=${c.active} WHERE id=${c.id} AND bookId=${book.id}`;if(changed!==1)throw new TradeError("科目不存在");return{id:book.id,summary:`${c.active?"启用":"停用"}科目：${c.reason}，历史分录保留`};}
  const month=monthCheck(c.month);if(month<book.startMonth)throw new TradeError("期间不能早于账套启用月");
  if(c.action==="add_period"){const found=await db.$queryRaw<Array<{id:string}>>`SELECT id FROM GLPeriod WHERE bookId=${book.id} AND month=${month}`;if(found.length)throw new TradeError("期间已存在");await db.$executeRaw`INSERT INTO GLPeriod(id,bookId,month,status,nextNumber) VALUES(${createId()},${book.id},${month},'open',1)`;return{id:book.id,summary:`新增期间 ${month}`};}
  const [period]=await db.$queryRaw<Array<{id:string;status:string}>>`SELECT id,status FROM GLPeriod WHERE bookId=${book.id} AND month=${month}`;if(!period)throw new TradeError("期间不存在");
  if(c.action==="close_period"){
   if(period.status!=="open")throw new TradeError("期间已经关闭");
   const [pending]=await db.$queryRaw<Array<{n:bigint}>>`SELECT COUNT(*) n FROM GLJournal WHERE bookId=${book.id} AND substr(date,1,7)=${month} AND status IN ('draft','reviewed')`;if(pending.n>BigInt(0))throw new TradeError("本期仍有草稿或未过账凭证，不能关闭");
   const older=await db.$queryRaw<Array<{id:string}>>`SELECT id FROM GLPeriod WHERE bookId=${book.id} AND month<${month} AND status='open' LIMIT 1`;if(older.length)throw new TradeError("请按顺序先关闭较早期间");
   const [sum]=await db.$queryRaw<Array<{d:bigint;c:bigint}>>`SELECT COALESCE(SUM(l.debitMinor),0) d,COALESCE(SUM(l.creditMinor),0) c FROM GLLine l JOIN GLJournal j ON j.id=l.journalId WHERE j.bookId=${book.id} AND j.status='posted' AND substr(j.date,1,7)<=${month}`;if(sum.d!==sum.c)throw new TradeError("账套试算不平衡，不能关闭期间");
   await db.$executeRaw`UPDATE GLPeriod SET status='closed',closeNote=${c.reason},closedBy=${actor.userId},closedAt=${now} WHERE id=${period.id}`;
   return{id:book.id,summary:`关闭演示期间 ${month}，依据：${c.reason}；未自动结转损益或申报税务`};
  }
  if(period.status!=="closed")throw new TradeError("期间尚未关闭");const later=await db.$queryRaw<Array<{id:string}>>`SELECT id FROM GLPeriod WHERE bookId=${book.id} AND month>${month} AND status='closed' LIMIT 1`;if(later.length)throw new TradeError("只能从最后已关闭期间依次重开");await db.$executeRaw`UPDATE GLPeriod SET status='open',closeNote=${c.reason},closedBy=NULL,closedAt=NULL WHERE id=${period.id}`;return{id:book.id,summary:`按依据重开演示期间 ${month}：${c.reason}，已过账分录仍不可改写`};
 }
 if(c.action==="save_journal"||c.action==="from_source"){
  const book=await ledgerBook(db,org,c.bookId);await openPeriod(db,book,c.date);
  if(c.action==="save_journal"){
   const existing=c.id?await journalRow(db,org,c.id):null;
   if(existing){if(existing.bookId!==book.id||existing.status==="posted"||existing.status==="void")throw new TradeError("已过账或作废凭证不能修改");requireVersion(existing.version,c.expectedVersion);if(existing.createdBy!==actor.userId)throw new TradeError("只能修订本人制单的草稿");if(existing.reversesId)throw new TradeError("反向凭证分录不能改写");}
   else requireVersion(0,c.expectedVersion);
   const id=existing?.id??createId();
   if(existing){await db.$executeRaw`DELETE FROM GLLine WHERE journalId=${id}`;await db.$executeRaw`UPDATE GLJournal SET date=${c.date},summary=${c.summary},basis=${c.basis},status='draft',version=version+1,reviewedBy=NULL,reviewedAt=NULL WHERE id=${id}`;}
   else await db.$executeRaw`INSERT INTO GLJournal(id,bookId,date,summary,basis,status,version,sourceType,createdBy,createdAt) VALUES(${id},${book.id},${c.date},${c.summary},${c.basis},'draft',1,'manual',${actor.userId},${now})`;
   await insertLines(db,book,id,c.lines);return{id,summary:`保存凭证草稿，${existing?"原复核已失效，":""}尚未过账`};
  }
  await requireTrade(actor,"trade_view",db);const organization=await db.organization.findUniqueOrThrow({where:{id:org}});if(c.rateDate>dateInZone(new Date(now),organization.timezone))throw new TradeError("\u4e0d\u80fd\u4f7f\u7528\u672a\u6765\u6c47\u7387\u6838\u5bf9\u65e5\u671f");const built=await buildSourceLines(db,actor,book,c),id=createId();
  for(const claim of built.source.claims){const [duplicate]=await db.$queryRaw<Array<{id:string}>>`SELECT id FROM GLSourceClaim WHERE bookId=${book.id} AND activeKey=${`${claim.type}:${claim.id}`}`;if(duplicate)throw new TradeError("本账套该来源已制单，不能重复入账");}
  await db.$executeRaw`INSERT INTO GLJournal(id,bookId,date,summary,basis,status,version,sourceType,sourceId,sourceHash,sourceJson,expectedTotalMinor,createdBy,createdAt) VALUES(${id},${book.id},${c.date},${`业务来源 ${c.sourceType} · ${c.sourceId.slice(-8)}`},${c.basis},'draft',1,${c.sourceType},${c.sourceId},${sourceHash(built.source.facts)},${JSON.stringify({facts:built.source.facts,rate:c.rate,rateDate:c.rateDate,carryingAmount:c.carryingAmount})},${built.total},${actor.userId},${now})`;
  await insertLines(db,book,id,built.lines);
  for(const claim of built.source.claims)await db.$executeRaw`INSERT INTO GLSourceClaim(id,bookId,journalId,sourceType,sourceId,activeKey) VALUES(${createId()},${book.id},${id},${claim.type},${claim.id},${`${claim.type}:${claim.id}`})`;
  return{id,summary:"按业务来源生成凭证草稿，须独立复核与过账"};
 }
 const j=await journalRow(db,org,c.id);requireVersion(j.version,c.expectedVersion);const book=await ledgerBook(db,org,j.bookId);
 if(c.action==="void_journal"){
  if(!["draft","reviewed"].includes(j.status))throw new TradeError("已过账凭证不能作废，请生成反向凭证");if(j.createdBy!==actor.userId&&!(await ledgerPermissions(actor,db)).has("ledger_config"))throw new TradeError("只有制单人或账套管理员可作废草稿");await openPeriod(db,book,j.date);
  await db.$executeRaw`UPDATE GLJournal SET status='void',version=version+1,voidReason=${c.reason} WHERE id=${j.id}`;await db.$executeRaw`UPDATE GLSourceClaim SET activeKey=NULL WHERE journalId=${j.id}`;return{id:j.id,summary:`作废未过账草稿：${c.reason}`};
 }
 if(c.action==="reverse_journal"){
  if(j.status!=="posted"||j.reversedById)throw new TradeError("原凭证未过账或已完成反向过账");await openPeriod(db,book,c.date);if(c.date<j.date)throw new TradeError("反向凭证日期不能早于原凭证");
  const duplicate=await db.$queryRaw<Array<{id:string}>>`SELECT id FROM GLJournal WHERE bookId=${book.id} AND reversesId=${j.id} AND status<>'void' LIMIT 1`;if(duplicate.length)throw new TradeError("已有反向凭证待处理");const id=createId();
  await db.$executeRaw`INSERT INTO GLJournal(id,bookId,date,summary,basis,status,version,sourceType,reversesId,createdBy,createdAt) VALUES(${id},${book.id},${c.date},${`冲销 ${j.number}`},${c.reason},'draft',1,'reversal',${j.id},${actor.userId},${now})`;
  const lines=await journalLines(db,j.id);await insertLines(db,book,id,lines.map(l=>({accountId:l.accountId,debit:formatMoney(l.creditMinor,book.baseCurrency),credit:formatMoney(l.debitMinor,book.baseCurrency),note:`反向 ${l.note}`})));return{id,summary:"生成反向凭证草稿，原凭证保留，须独立复核后过账"};
 }
 if(c.action==="review_journal"){
  if(j.status!=="draft")throw new TradeError("只有草稿可以复核");if(j.createdBy===actor.userId)throw new TradeError("制单人不能复核本人凭证，请另一位获授权同事复核");await validateJournal(db,actor,j);
  await db.$executeRaw`UPDATE GLJournal SET status='reviewed',reviewedBy=${actor.userId},reviewedAt=${now},version=version+1 WHERE id=${j.id}`;return{id:j.id,summary:"凭证已独立复核，尚未过账"};
 }
 if(c.action!=="post_journal"||j.status!=="reviewed"||!j.reviewedBy||j.reviewedBy===j.createdBy)throw new TradeError("凭证须先完成独立复核");
 await validateJournal(db,actor,j);const organization=await db.organization.findUniqueOrThrow({where:{id:org}});if(j.date>dateInZone(new Date(now),organization.timezone))throw new TradeError("不能对未来日期凭证过账");
 const period=await openPeriod(db,book,j.date),number=`${j.date.slice(0,7).replace('-','')}-${String(period.nextNumber).padStart(4,'0')}`;
 await db.$executeRaw`UPDATE GLPeriod SET nextNumber=nextNumber+1 WHERE id=${period.id}`;
 await db.$executeRaw`UPDATE GLJournal SET status='posted',number=${number},postedBy=${actor.userId},postedAt=${now},version=version+1 WHERE id=${j.id}`;
 if(j.reversesId){await db.$executeRaw`UPDATE GLJournal SET reversedById=${j.id},version=version+1 WHERE id=${j.reversesId}`;await db.$executeRaw`UPDATE GLSourceClaim SET activeKey=NULL WHERE journalId=${j.reversesId}`;}
 return{id:j.id,summary:`演示账套凭证 ${number} 已过账，分录不可直接改写`};
}
