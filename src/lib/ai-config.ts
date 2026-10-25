export type AiMode = "mock" | "live";

export function getAiMode(): AiMode {
  return process.env.AI_MODE === "live" ? "live" : "mock";
}

export function getAiConfig() {
  return {
    mode: getAiMode(),
    provider: process.env.AI_PROVIDER || "openai-compatible",
    baseUrl: process.env.AI_BASE_URL || "",
    apiKey: process.env.AI_API_KEY || "",
    model: process.env.AI_MODEL || "",
    capabilities: (process.env.AI_CAPABILITIES || "text,structured-output")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
  };
}

export function liveConfigured() {
  const config = getAiConfig();
  return Boolean(config.baseUrl && config.apiKey && config.model);
}

export function visionConfigured() {
  const config = getAiConfig();
  return config.capabilities.includes("vision") || Boolean(process.env.AI_VISION_MODEL);
}

export function getImageConfig() {
  const text = getAiConfig();
  const provider = process.env.AI_IMAGE_PROVIDER || "bailian-native";
  return {
    mode: process.env.AI_IMAGE_MODE || text.mode,
    provider,
    baseUrl: process.env.AI_IMAGE_BASE_URL || (provider === "bailian-native" ? "https://dashscope.aliyuncs.com/api/v1" : text.baseUrl),
    apiKey: process.env.AI_IMAGE_API_KEY || (provider === "bailian-native" ? process.env.AGENT_API_KEY : text.apiKey) || "",
    model: process.env.AI_IMAGE_MODEL || (provider === "bailian-native" ? "wan2.7-image-pro" : ""),
  };
}
export function imageModelName() { return getImageConfig().model; }
export function imageLiveConfigured() {
  const c = getImageConfig();
  return c.mode === "live" && Boolean(c.baseUrl && c.apiKey && c.model);
}
export function imageConfigStatus() {
  return imageLiveConfigured()
    ? { ready: true as const, message: `${imageModelName()} 已配置；点击生成将真实调用，结果需人工审阅。` }
    : { ready: false as const, message: "真实图像模型未启用或密钥未齐，不能生成；不会用假图冒充。" };
}

export function aiModeLabel(mode: AiMode) {
  return mode === "live" ? "真实模型调用" : "演示模式，未调用真实模型";
}
