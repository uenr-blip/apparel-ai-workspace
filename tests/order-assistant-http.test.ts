import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/auth", () => ({ getSession: vi.fn() }));
vi.mock("@/server/services/order-assistant", () => ({ searchOrderAssistant: vi.fn(), previewOrderAssistant: vi.fn(), confirmOrderAssistant: vi.fn() }));
import { getSession } from "@/lib/auth";
import { searchOrderAssistant, confirmOrderAssistant } from "@/server/services/order-assistant";
import { POST } from "@/app/api/orders/assistant/route";

const session = { id: "sales", organizationId: "org", role: "salesperson", factoryId: null, email: "test@demo.local", name: "test" };
function request(body: object, origin = "http://127.0.0.1:3100") {
  return new Request("http://localhost:3100/api/orders/assistant", { method: "POST", headers: { origin, host: "127.0.0.1:3100", "content-type": "application/json" }, body: JSON.stringify(body) });
}
describe("一句话建单 HTTP 边界", () => {
  beforeEach(() => { vi.resetAllMocks(); vi.mocked(getSession).mockResolvedValue(session); });
  it("内部 localhost 与实际 Host 不同时允许同源请求，身份只来自会话", async () => {
    vi.mocked(searchOrderAssistant).mockResolvedValue({ customer: { id: "c", code: "C", name: "客户" }, candidates: [], limited: false, modeLabel: "本地规则" });
    expect((await POST(request({ action: "search", text: "给客户建一个针织订单" }))).status).toBe(200);
    expect(searchOrderAssistant).toHaveBeenCalledWith({ organizationId: "org", userId: "sales", role: "salesperson", factoryId: null }, "给客户建一个针织订单");
  });
  it("跨站、未登录、伪造用户字段拒绝，不调用业务服务", async () => {
    expect((await POST(request({ action: "search", text: "给客户建一个针织订单" }, "https://other.example"))).status).toBe(403);
    expect((await POST(request({ action: "search", text: "给客户建一个针织订单", userId: "manager" }))).status).toBe(400);
    vi.mocked(getSession).mockResolvedValue(null);
    expect((await POST(request({ action: "search", text: "给客户建一个针织订单" }))).status).toBe(401);
    expect(searchOrderAssistant).not.toHaveBeenCalled();
  });
  it("拒绝超长输入及未明确确认的提交", async () => {
    expect((await POST(request({ action: "search", text: "字".repeat(4000) }))).status).toBe(413);
    expect((await POST(request({ action: "confirm", proposalId: "p", confirmed: false }))).status).toBe(400);
    expect(confirmOrderAssistant).not.toHaveBeenCalled();
  });
});
