import { beforeEach,describe,expect,it,vi } from "vitest";
import { IDS } from "@/lib/constants";
import { prisma } from "@/lib/db";
import { resetDatabase } from "./helpers";
import { runLedgerCommand } from "@/server/services/ledger-write";
import { getLedgerTrial,getLedgerJournal } from "@/server/services/ledger-read";
import { setUserPermission } from "@/server/services/user-permissions";
import { getWorkspaceSnapshot } from "@/server/services/workspace";
const {current}=vi.hoisted(()=>({current:{user:null as null|{id:string;organizationId:string;role:string;factoryId:null}}}));
vi.mock("@/lib/auth",()=>({getSession:async()=>current.user}));
import { POST } from "@/app/api/finance/ledger/route";
import { GET as lookup } from "@/app/api/finance/ledger/lookup/route";
import { GET as exportTrial } from "@/app/api/finance/ledger/export/route";
const actor={organizationId:IDS.orgDemo,userId:IDS.userManager,role:"manager",factoryId:null};
describe("总账HTTP与组织权限",()=>{
 beforeEach(async()=>{await resetDatabase();current.user={id:actor.userId,organizationId:actor.organizationId,role:actor.role,factoryId:null};});
 it("未登录、跨站、超大请求均不能制单",async()=>{current.user=null;expect((await POST(new Request("http://localhost:3100/api/finance/ledger",{method:"POST",headers:{"Content-Type":"application/json"},body:"{}"}))).status).toBe(401);current.user={id:actor.userId,organizationId:actor.organizationId,role:"manager",factoryId:null};expect((await POST(new Request("http://localhost:3100/api/finance/ledger",{method:"POST",headers:{"Content-Type":"application/json",Origin:"https://other.example"},body:"{}"}))).status).toBe(403);expect((await POST(new Request("http://localhost:3100/api/finance/ledger",{method:"POST",headers:{"Content-Type":"application/json"},body:"x".repeat(65537)}))).status).toBe(413);});
 it("有权限的另一组织经理也不能读本账套及凭证",async()=>{const book=await runLedgerCommand(actor,{action:"create_book",name:"隔离检查",baseCurrency:"CNY",startMonth:"2026-09",idempotencyKey:"book"});await prisma.user.create({data:{id:"other-gl-manager",organizationId:IDS.orgIso,email:"other-gl@test.local",name:"其他组织经理",role:"manager",passwordHash:"unused"}});const other={...actor,organizationId:IDS.orgIso,userId:"other-gl-manager"};await expect(getLedgerTrial(other,book.id,"2026-09")).rejects.toThrow(/不存在|组织/);await expect(getLedgerJournal(other,"unknown-journal")).rejects.toThrow(/不存在/);});
 it("总账查阅不附带导出，撤权后旧身份立即失效",async()=>{const book=await runLedgerCommand(actor,{action:"create_book",name:"授权检查",baseCurrency:"CNY",startMonth:"2026-09",idempotencyKey:"permissions-book"});await setUserPermission({organizationId:actor.organizationId,managerId:actor.userId,targetUserId:IDS.userSales,action:"ledger_view",enabled:true});current.user={id:IDS.userSales,organizationId:IDS.orgDemo,role:"salesperson",factoryId:null};expect((await lookup(new Request(`http://localhost:3100/api/finance/ledger/lookup?kind=accounts&bookId=${book.id}`))).status).toBe(200);expect((await exportTrial(new Request(`http://localhost:3100/api/finance/ledger/export?bookId=${book.id}&month=2026-09`))).status).toBe(403);await setUserPermission({organizationId:actor.organizationId,managerId:actor.userId,targetUserId:IDS.userSales,action:"ledger_view",enabled:false});expect((await lookup(new Request(`http://localhost:3100/api/finance/ledger/lookup?kind=accounts&bookId=${book.id}`))).status).toBe(403);});
  it("导出使用安全CSV并留审计",async()=>{const book=await runLedgerCommand(actor,{action:"create_book",name:"导出账套",baseCurrency:"CNY",startMonth:"2026-09",idempotencyKey:"export-book"});await runLedgerCommand(actor,{action:"create_account",bookId:book.id,code:"SAFE",name:"=HYPERLINK(1)",category:"asset",idempotencyKey:"formula-account"});const res=await exportTrial(new Request(`http://localhost:3100/api/finance/ledger/export?bookId=${book.id}&month=2026-09`));expect(res.status).toBe(200);expect(await res.text()).toContain("'=HYPERLINK");expect(await prisma.auditEvent.count({where:{action:"ledger.export"}})).toBe(1);});
 it("工作台活动不能绕过总账与财务查阅权限",async()=>{
  for(const entityType of ["GeneralLedger","TradeLedger","Treasury"])await prisma.auditEvent.create({data:{id:`private-${entityType}`,organizationId:actor.organizationId,actorUserId:actor.userId,actorType:"user",action:"privacy.check",entityType,entityId:"private",summary:`PRIVATE-${entityType}-99999`}});
  const staff={...actor,userId:IDS.userSales,role:"salesperson"};
  expect(JSON.stringify(await getWorkspaceSnapshot(actor.organizationId,staff))).not.toContain("PRIVATE-");
  await setUserPermission({organizationId:actor.organizationId,managerId:actor.userId,targetUserId:staff.userId,action:"ledger_view",enabled:true});
  const result=JSON.stringify(await getWorkspaceSnapshot(actor.organizationId,staff));expect(result).toContain("PRIVATE-GeneralLedger");expect(result).not.toContain("PRIVATE-TradeLedger");expect(result).not.toContain("PRIVATE-Treasury");
 });
});
