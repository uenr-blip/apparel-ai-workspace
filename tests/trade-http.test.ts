import { expenseSubject } from "@/server/services/stage-expenses";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { IDS } from "@/lib/constants";
import { prisma } from "@/lib/db";
import { resetDatabase } from "./helpers";
const { session } = vi.hoisted(() => ({ session: { current: null as null | { id: string; organizationId: string; role: string; factoryId: null } } }));
vi.mock("@/lib/auth", () => ({ getSession: async () => session.current }));
import { POST } from "@/app/api/finance/trade/route";
import { GET as download } from "@/app/api/finance/trade/documents/[id]/file/route";
import { GET as lookup } from "@/app/api/finance/trade/lookup/route";
import { checkTradeOrigin } from "@/server/services/trade-http";
import { runTradeCommand } from "@/server/services/trade-write";
describe("外贸HTTP权限与输入边界", () => {
  beforeEach(async () => { await resetDatabase(); session.current = { id: IDS.userManager, organizationId: IDS.orgDemo, role: "manager", factoryId: null }; });
  it("未登录和跨站写入被拒绝", async () => {
    session.current = null;
    expect((await POST(new Request("http://localhost:3100/api/finance/trade", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }))).status).toBe(401);
    expect((await POST(new Request("http://localhost:3100/api/finance/trade", { method: "POST", headers: { Origin: "https://external.example", "Content-Type": "application/json" }, body: "{}" }))).status).toBe(403);
  });
  it("同源校验使用实际Host，兼容Next重建内部请求地址", () => {
    const local = new Request("http://localhost:3101/api/finance/trade", { headers: { Host: "127.0.0.1:3101", Origin: "http://127.0.0.1:3101" } });
    expect(() => checkTradeOrigin(local)).not.toThrow();
    const external = new Request("http://localhost:3101/api/finance/trade", { headers: { Host: "127.0.0.1:3101", Origin: "http://external.example" } });
    expect(() => checkTradeOrigin(external)).toThrow(/来源/);
  });
  it("表单伪造角色无效，工厂不可查外贸或下载附件", async () => {
    session.current = { id: IDS.userFactory, organizationId: IDS.orgDemo, role: "factory", factoryId: null };
    expect((await POST(new Request("http://localhost:3100/api/finance/trade", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ role: "manager", organizationId: IDS.orgDemo }) }))).status).toBe(403);
    expect((await lookup(new Request("http://localhost:3100/api/finance/trade/lookup?kind=orders"))).status).toBe(403);
    expect((await download(new Request("http://localhost:3100/file"), { params: Promise.resolve({ id: "any" }) })).status).toBe(403);
  });
  it("限制大请求，数据库路径和内部异常不进入响应", async () => {
    const response = await POST(new Request("http://localhost:3100/api/finance/trade", { method: "POST", headers: { "Content-Type": "application/json" }, body: "x".repeat(65537) }));
    expect(response.status).toBe(413); expect(await response.text()).not.toContain("prisma");
    expect(await prisma.tradeOperation.count()).toBe(0);
  });
  it("附件下载返回原字节，另一组织即使有查阅权限也只能得到404", async () => {
    const actor = { organizationId: IDS.orgDemo, userId: IDS.userManager, role: "manager", factoryId: null };
    const bytes = Buffer.from("%PDF-1.7\nprivate document\n%%EOF");
    const doc = await runTradeCommand(actor, { action: "add_document", orderId: "order-demo-005", kind: "other", number: "PRIVATE-FILE", issuedOn: "2026-09-20", note: "附件隔离测试", idempotencyKey: "private-file" }, { filename: "receipt.pdf", mimeType: "application/pdf", bytes });
    const request = new Request(`http://localhost:3100/api/finance/trade/documents/${doc.id}/file`), context = { params: Promise.resolve({ id: doc.id }) };
    const response = await download(request, context);
    expect(response.status).toBe(200); expect(Buffer.from(await response.arrayBuffer())).toEqual(bytes);
    expect(response.headers.get("cache-control")).toContain("no-store");
    await prisma.user.create({ data: { id: "download-iso-manager", organizationId: IDS.orgIso, email: "download-iso@test.local", name: "隔离经理", role: "manager", passwordHash: "unused" } });
    session.current = { id: "download-iso-manager", organizationId: IDS.orgIso, role: "manager", factoryId: null };
    expect((await download(request, context)).status).toBe(404);
  });
  it("阶段费用可经真实表单上传凭据并通过受保护入口回查", async () => {
    const actor = { organizationId: IDS.orgDemo, userId: IDS.userManager, role: "manager", factoryId: null };
    const project = await prisma.developmentProject.create({ data: { id: "http-expense-project", organizationId: IDS.orgDemo, code: "DEV-HTTP-FEE", name: "阶段费用原件", status: "open", unknownsJson: "[]" } });
    const subject = await expenseSubject(actor, { projectId: project.id });
    const form = new FormData();
    form.set("command", JSON.stringify({ action: "create_stage_expense", idempotencyKey: "http-stage-fee", projectId: project.id, expectedStamp: subject.stamp, partyId: IDS.factoryYunshan, title: "样衣费", expenseKind: "sampling", currency: "CNY", amount: "50", expenseDate: "2026-09-28", dueDate: "2026-10-01", expenseReference: "FEE-HTTP-1", basis: "测试费用凭据" }));
    form.set("file", new File(["%PDF-1.4\nprivate stage fixture"], "sample.pdf", { type: "application/pdf" }));
    const response = await POST(new Request("http://localhost:3100/api/finance/trade", { method: "POST", headers: { origin: "http://localhost:3100" }, body: form }));
    expect(response.status).toBe(200);
    const created = await response.json();
    const doc = await prisma.tradeDocument.findFirstOrThrow({ where: { billId: created.id } });
    expect(doc.orderId).toBeNull();
    const original = await download(new Request(`http://localhost:3100/api/finance/trade/documents/${doc.id}/file?preview=1`), { params: Promise.resolve({ id: doc.id }) });
    expect(original.status).toBe(200); expect(original.headers.get("content-type")).toContain("application/pdf");
    session.current = { id: IDS.userFactory, organizationId: IDS.orgDemo, role: "factory", factoryId: null };
    expect((await download(new Request(`http://localhost:3100/api/finance/trade/documents/${doc.id}/file`), { params: Promise.resolve({ id: doc.id }) })).status).toBe(403);
  });

});
