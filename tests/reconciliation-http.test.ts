import { beforeEach, describe, expect, it, vi } from "vitest";
import { IDS } from "@/lib/constants";
import { prisma } from "@/lib/db";
import { resetDatabase } from "./helpers";
import { runLedgerCommand } from "@/server/services/ledger-write";
import { setUserPermission } from "@/server/services/user-permissions";
const { session } = vi.hoisted(() => ({ session: { user: null as null | { id: string; organizationId: string; role: string; factoryId: null } } }));
vi.mock("@/lib/auth", () => ({ getSession: async () => session.user }));
import { GET, POST } from "@/app/api/finance/reconciliation/route";
const actor = { organizationId: IDS.orgDemo, userId: IDS.userManager, role: "manager", factoryId: null };
const url = "http://localhost:3100/api/finance/reconciliation";
const request = (body: unknown, headers: Record<string, string> = {}) => new Request(url, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) });
describe("金额核对HTTP边界", () => {
  beforeEach(async () => { await resetDatabase(); session.user = { id: actor.userId, organizationId: actor.organizationId, role: actor.role, factoryId: null }; });
  it("未登录、跨站及超大请求不修改核对口径", async () => {
    session.user = null; expect((await POST(request({}))).status).toBe(401);
    session.user = { id: actor.userId, organizationId: actor.organizationId, role: actor.role, factoryId: null };
    expect((await POST(request({}, { Origin: "https://untrusted.example" }))).status).toBe(403);
    expect((await POST(request("x".repeat(65537)))).status).toBe(413);
  });
  it("查阅不自动获得配置权限，角色和权限来自当前会话", async () => {
    const b = await runLedgerCommand(actor, { action: "create_book", name: "HTTP核对", baseCurrency: "CNY", startMonth: "2026-09", idempotencyKey: "http-money-book" });
    for (const action of ["ledger_view", "trade_view"]) await setUserPermission({ organizationId: actor.organizationId, managerId: actor.userId, targetUserId: IDS.userSales, action, enabled: true });
    session.user = { id: IDS.userSales, organizationId: actor.organizationId, role: "salesperson", factoryId: null };
    const lookup = await GET(new Request(url + "?kind=payable&bookId=" + b.id)); expect(lookup.status).toBe(200);
    const data = await lookup.json(); expect(data.rows.some((r: { label: string }) => r.label.includes("L-AP"))).toBe(true);
    expect((await POST(request({ action: "save_reconciliation_rule", bookId: b.id, accounts: { receivable: [], payable: [], funds: [], cost: [] }, rates: [], basis: "不能越权", expectedVersion: 0, idempotencyKey: "denied", role: "manager" }))).status).toBe(403);
    await setUserPermission({ organizationId: actor.organizationId, managerId: actor.userId, targetUserId: IDS.userSales, action: "trade_view", enabled: false });
    expect((await GET(new Request(url + "?kind=payable&bookId=" + b.id))).status).toBe(403);
  });
  it("另一组织的真实经理也不能查本账簿科目", async () => {
    const b = await runLedgerCommand(actor, { action: "create_book", name: "跨组织核对", baseCurrency: "CNY", startMonth: "2026-09", idempotencyKey: "http-other-book" });
    await prisma.user.create({ data: { id: "other-recon-manager", organizationId: IDS.orgIso, email: "recon-other@demo.local", name: "隔离经理", role: "manager", passwordHash: "unused" } });
    session.user = { id: "other-recon-manager", organizationId: IDS.orgIso, role: "manager", factoryId: null };
    expect((await GET(new Request(url + "?kind=payable&bookId=" + b.id))).status).toBe(404);
  });
});
