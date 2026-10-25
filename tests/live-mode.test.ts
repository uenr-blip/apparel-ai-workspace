import { afterEach, describe, expect, it } from "vitest";
import { LiveAiError, liveExtract } from "@/server/ai/live";

describe("live 模式诚实失败", () => {
  const original = { ...process.env };

  afterEach(() => {
    process.env.AI_MODE = original.AI_MODE;
    process.env.AI_BASE_URL = original.AI_BASE_URL;
    process.env.AI_API_KEY = original.AI_API_KEY;
    process.env.AI_MODEL = original.AI_MODEL;
  });

  it("缺少配置时抛出错误，不返回 mock 结果", async () => {
    process.env.AI_MODE = "live";
    process.env.AI_BASE_URL = "";
    process.env.AI_API_KEY = "";
    process.env.AI_MODEL = "";
    await expect(liveExtract("给北岸服饰追加 ST-26018")).rejects.toBeInstanceOf(LiveAiError);
  });
});
