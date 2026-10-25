/** Service-side configuration; never pass credentials to a client component. */
export const AGENT_PROFILES = ["default", "qwen-max", "deepseek"] as const;
export type AgentProfile = typeof AGENT_PROFILES[number];
export function agentConfig(profile: AgentProfile = "default") {
  if (!AGENT_PROFILES.includes(profile)) throw new Error("不支持的模型选项");
  const mode = process.env.AGENT_MODE === "mock" ? "mock" : "live";
  if (profile === "deepseek") return {
    mode, provider: "deepseek", model: process.env.DEEPSEEK_MODEL || "deepseek-flash",
    baseUrl: process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com",
    apiKey: process.env.DEEPSEEK_API_KEY?.trim() || "", keyName: "DEEPSEEK_API_KEY",
  };
  return {
    mode, provider: process.env.AGENT_PROVIDER || "bailian",
    baseUrl: process.env.AGENT_BASE_URL || "https://dashscope.aliyuncs.com/compatible-mode/v1",
    model: profile === "qwen-max" ? "qwen3.8-max" : process.env.AGENT_MODEL || "qwen3.7-plus",
    apiKey: process.env.AGENT_API_KEY?.trim() || "", keyName: "AGENT_API_KEY",
  };
}
export function agentStatus(profile: AgentProfile = "default") {
  const c = agentConfig(profile), name = c.provider === "deepseek" ? "DeepSeek" : "千问";
  return { profile, mode: c.mode, model: c.model, provider: c.provider,
    ready: c.mode === "live" && Boolean(c.apiKey),
    label: c.mode === "mock" ? "本地验证，未调用真实模型" : c.apiKey ? `${name} · ${c.model}（密钥已配置，连接待本次查询验证）` : `智能体待配置：请在 .env 填写 ${c.keyName} 后重启` };
}
export function agentOptions() {
  return AGENT_PROFILES.map(profile => ({ ...agentStatus(profile), name: profile === "default" ? `默认 · ${agentConfig().model}` : profile === "qwen-max" ? "千问 3.8 Max" : "DeepSeek Flash" }));
}
