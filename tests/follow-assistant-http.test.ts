import { beforeEach, expect, it, vi } from "vitest";
vi.mock("@/lib/auth", () => ({ getSession: vi.fn() }));
vi.mock("@/server/services/order-merch", () => ({ createFollowSheet: vi.fn() }));
import { getSession } from "@/lib/auth";
import { createFollowSheet } from "@/server/services/order-merch";
import { POST } from "@/app/api/orders/follow/route";
const session = { id: "current-user", organizationId: "current-org", role: "salesperson", factoryId: null, name: "业务员", email: "test@example.local" };
const fields = { kind: "bulk", title: "SS27大货", factoryName: "样例工厂", idempotencyKey: "follow-http-test", assistantTicket: "signed-preview", confirmed: true };
const request = (body: object, origin = "http://127.0.0.1:3100") => new Request("http://127.0.0.1:3100/api/orders/follow", { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(body) });
beforeEach(() => { vi.resetAllMocks(); vi.mocked(getSession).mockResolvedValue(session); });

it("跟单提交只接受当前会话身份，未登录、跨站、额外款式数量和伪造身份均不会调用写服务", async () => {
  vi.mocked(getSession).mockResolvedValue(null);
  expect((await POST(request(fields))).status).toBe(401);
  vi.mocked(getSession).mockResolvedValue(session);
  expect((await POST(request(fields, "https://external.example"))).status).toBe(403);
  expect((await POST(request({ ...fields, role: "manager", userId: "other" }))).status).toBe(400);
  expect((await POST(request({ ...fields, styles: [{ qty: 100 }] }))).status).toBe(400);
  expect((await POST(request({ ...fields, assistantTicket: "x".repeat(21000) }))).status).toBe(413);
  expect(createFollowSheet).not.toHaveBeenCalled();
});

it("确认提交携带建议凭据和最终表头进入原服务；数据库失败不返回内部信息", async () => {
  vi.mocked(createFollowSheet).mockResolvedValue({ sheetId: "new-sheet", reused: false, message: "已建表" });
  const result = await POST(request(fields));
  expect(result.status).toBe(200);
  expect(createFollowSheet).toHaveBeenCalledWith({ ...fields, organizationId: session.organizationId, userId: session.id, role: session.role, factoryId: null });
  const error = new Error("SELECT sensitive details"); error.name = "PrismaClientKnownRequestError";
  vi.mocked(createFollowSheet).mockRejectedValue(error);
  expect(await (await POST(request(fields))).text()).not.toMatch(/SELECT|sensitive|Prisma/);
});
