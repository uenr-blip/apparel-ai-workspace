import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/auth", () => ({ getSession: vi.fn() }));
vi.mock("@/server/agents/business-agent", () => ({ runBusinessAgent: vi.fn() }));
import { getSession } from "@/lib/auth";
import { runBusinessAgent } from "@/server/agents/business-agent";
import { GET, POST } from "@/app/api/agents/route";
const session = { id: "actor", organizationId: "org", role: "salesperson", factoryId: null, name: "业务员", email: "test@example.local" };
const request = (body: object, origin = "http://127.0.0.1:3100") => new Request("http://localhost:3100/api/agents", { method: "POST", headers: { host: "127.0.0.1:3100", origin, "content-type": "application/json" }, body: JSON.stringify(body) });
beforeEach(() => { vi.resetAllMocks(); vi.mocked(getSession).mockResolvedValue(session); });
afterEach(() => vi.unstubAllEnvs());
describe("智能体 HTTP 边界", () => {
  it("未登录、跨站、伪造身份和超长文本不会调用模型", async () => {
    vi.mocked(getSession).mockResolvedValue(null);
    expect((await POST(request({ module: "finance", text: "查客户" }))).status).toBe(401);
    vi.mocked(getSession).mockResolvedValue(session);
    expect((await POST(request({ module: "finance", text: "查客户" }, "https://external.example"))).status).toBe(403);
    expect((await POST(request({ module: "finance", text: "查客户", role: "manager" }))).status).toBe(400);
    expect((await POST(request({ module: "finance", text: "查".repeat(3000) }))).status).toBe(413);
    expect((await POST(request({ module: "review", text: "查审版", profile: "https://untrusted.example" }))).status).toBe(400);
    expect(runBusinessAgent).not.toHaveBeenCalled();
  });
  it("模型状态不返回密钥；服务异常不返回数据库细节", async () => {
    vi.stubEnv("AGENT_API_KEY", "never-output-secret");
    const status = await GET(); expect(await status.text()).not.toContain("never-output-secret");
    const error = new Error("SELECT secret database path"); error.name = "PrismaClientKnownRequestError";
    vi.mocked(runBusinessAgent).mockRejectedValue(error);
    const result = await POST(request({ module: "review", text: "查审版" }));
    expect(await result.text()).not.toMatch(/SELECT|secret|Prisma/);
  });
});
