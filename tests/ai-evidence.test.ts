import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IDS } from "@/lib/constants";
import { prisma } from "@/lib/db";
import { liveExtract } from "@/server/ai/live";
import { mockExtract } from "@/server/ai/mock";
import { ingestText, parseSource } from "@/server/services/intake";
import { resetDatabase } from "./helpers";

const raw = "给北岸服饰追加 ST-26018，海军蓝 600 件、灰色 400 件，总量 1000 件。";
function respond(value: unknown) {
  return vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(value) } }] })));
}
beforeEach(() => {
  vi.stubEnv("AI_MODE", "live");
  vi.stubEnv("AI_BASE_URL", "https://unused.invalid/v1");
  vi.stubEnv("AI_API_KEY", "test-only-never-sent");
  vi.stubEnv("AI_MODEL", "test-model");
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
describe("AI原文证据", () => {
  it.each(["out_of_range", "wrong_text", "missing"] as const)("拒绝伪造或不完整来源 %s", async kind => {
    const result = mockExtract(raw);
    if (kind === "out_of_range") result.totalQuantity.start = 9999;
    if (kind === "wrong_text") result.totalQuantity.sourceText = "总量777件";
    if (kind === "missing") Object.assign(result.totalQuantity, { start: null, end: null, sourceText: null });
    vi.stubGlobal("fetch", respond(result));
    await expect(liveExtract(raw)).rejects.toThrow(/来源|证据/);
  });
  it("正常字段原文可核对且请求给出明确结构", async () => {
    const fetcher = respond(mockExtract(raw));
    vi.stubGlobal("fetch", fetcher);
    expect((await liveExtract(raw)).totalQuantity.value).toBe(1000);
    const request = (fetcher.mock.calls as unknown as Array<[string, RequestInit]>)[0][1];
    expect(String(request.body)).toContain("customerName");
    expect(String(request.body)).toContain("sourceText");
  });
  it("不能借真实片段夹带不同的数量", async () => {
    const result = mockExtract(raw);
    result.totalQuantity.value = 777;
    vi.stubGlobal("fetch", respond(result));
    await expect(liveExtract(raw)).rejects.toThrow(/来源|证据/);
  });
  it("未知字段不得携带可执行的值", async () => {
    const result = mockExtract(raw);
    Object.assign(result.totalQuantity, { value: 777, kind: "unknown", sourceText: null, start: null, end: null });
    vi.stubGlobal("fetch", respond(result));
    await expect(liveExtract(raw)).rejects.toThrow(/来源|证据/);
  });
  it("模型畸形响应不得把敏感响应原文写入错误", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: "secret-value-not-for-logs" } }] }))));
    await expect(liveExtract(raw)).rejects.toThrow();
    try { await liveExtract(raw); } catch (error) { expect(String(error)).not.toContain("secret-value"); }
  });
  it("重新解析失败时旧预览不可继续批准，也不保存伪造片段", async () => {
    await resetDatabase();
    const source = await ingestText({ organizationId: IDS.orgDemo, userId: IDS.userSales, text: raw, origin: "test" });
    vi.stubGlobal("fetch", respond(mockExtract(raw)));
    const first = await parseSource({ organizationId: IDS.orgDemo, userId: IDS.userSales, sourceId: source.source.id });
    expect(first.proposal).toBeTruthy();
    const forged = mockExtract(raw);
    forged.totalQuantity.sourceText = "原文没有的777";
    vi.stubGlobal("fetch", respond(forged));
    await expect(parseSource({ organizationId: IDS.orgDemo, userId: IDS.userSales, sourceId: source.source.id })).rejects.toThrow(/来源|证据/);
    expect(await prisma.actionProposal.count({ where: { sourceDocumentId: source.source.id, status: "preview" } })).toBe(0);
    expect(await prisma.sourceFragment.count({ where: { sourceDocumentId: source.source.id, text: "原文没有的777" } })).toBe(0);
    expect((await prisma.sourceDocument.findUniqueOrThrow({ where: { id: source.source.id } })).parseStatus).toBe("failed");
  });
});
