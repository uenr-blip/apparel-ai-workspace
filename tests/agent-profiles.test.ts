import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { agentConfig, agentOptions } from "@/lib/agent-config";
import { completionFor, runToolLoop } from "@/server/agents/runtime";
beforeEach(() => {
  vi.stubEnv("AGENT_MODE", "live"); vi.stubEnv("AGENT_PROVIDER", "bailian");
  vi.stubEnv("AGENT_MODEL", "qwen3.7-plus"); vi.stubEnv("AGENT_BASE_URL", "https://dashscope.aliyuncs.com/compatible-mode/v1");
  vi.stubEnv("AGENT_API_KEY", "bailian-test-key"); vi.stubEnv("DEEPSEEK_API_KEY", "deepseek-test-key");
  vi.stubEnv("DEEPSEEK_BASE_URL", "https://api.deepseek.com"); vi.stubEnv("DEEPSEEK_MODEL", "deepseek-flash");
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
describe("模型选择和密钥隔离", () => {
  it("保留默认3.7，3.8共用百炼密钥，DeepSeek独立；状态不包含凭据", () => {
    expect(agentConfig().model).toBe("qwen3.7-plus");
    expect(agentConfig("qwen-max").model).toBe("qwen3.8-max");
    expect(agentConfig("qwen-max").apiKey).toBe("bailian-test-key");
    expect(agentConfig("deepseek").apiKey).toBe("deepseek-test-key");
    expect(JSON.stringify(agentOptions())).not.toMatch(/bailian-test-key|deepseek-test-key/);
  });
  it("DeepSeek缺密钥时不借用百炼密钥、不调用网络", async () => {
    vi.stubEnv("DEEPSEEK_API_KEY", ""); const network = vi.fn(); vi.stubGlobal("fetch", network);
    await expect(completionFor(agentConfig("deepseek"))([], [])).rejects.toThrow(/DEEPSEEK_API_KEY/);
    expect(network).not.toHaveBeenCalled();
  });
  it.each(["qwen-max", "deepseek"] as const)("%s 完成工具往返，地址、密钥、请求参数与模型相符", async profile => {
    const response = (message: object) => new Response(JSON.stringify({ choices: [{ message }] }), { status: 200 });
    const network = vi.fn().mockImplementationOnce(async () => response({ content: null, tool_calls: [{ id: "call-1", type: "function", function: { name: "read", arguments: "{}" } }] })).mockImplementationOnce(async () => response({ content: "已核对", tool_calls: null }));
    vi.stubGlobal("fetch", network);
    const read = vi.fn().mockResolvedValue({ status: "approved" });
    const result = await runToolLoop({ text: "这个版审过了吗", instructions: "", tools: [{ name: "read", description: "读取版次", parameters: { type: "object" }, run: read }], completion: completionFor(agentConfig(profile)) });
    expect(result.answer).toBe("已核对"); expect(read).toHaveBeenCalledOnce();
    const [url, init] = network.mock.calls[0]; const body = JSON.parse(init.body);
    expect(url).toBe(profile === "deepseek" ? "https://api.deepseek.com/chat/completions" : "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions");
    expect(init.headers.Authorization).toBe(profile === "deepseek" ? "Bearer deepseek-test-key" : "Bearer bailian-test-key");
    expect(body.model).toBe(profile === "deepseek" ? "deepseek-flash" : "qwen3.8-max");
    if (profile === "deepseek") { expect(body.thinking).toEqual({ type: "disabled" }); expect(body).not.toHaveProperty("enable_thinking"); }
    else { expect(body.enable_thinking).toBe(false); expect(body).not.toHaveProperty("thinking"); }
    const followup = JSON.parse(network.mock.calls[1][1].body);
    expect(followup.messages.at(-1)).toMatchObject({ role: "tool", tool_call_id: "call-1", content: '{"status":"approved"}' });
  });
  it("鉴权失败仅报告所选服务商，不回退到其他模型", async () => {
    const network = vi.fn().mockResolvedValue(new Response("secret provider details", { status: 401 })); vi.stubGlobal("fetch", network);
    await expect(completionFor(agentConfig("deepseek"))([], [])).rejects.toThrow(/DeepSeek密钥/);
    expect(network).toHaveBeenCalledOnce();
  });
});
