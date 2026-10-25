import { loadEnvConfig } from "@next/env";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";

async function main() {
  loadEnvConfig(process.cwd());
  const { agentConfig, AGENT_PROFILES } = await import("../src/lib/agent-config");
  const profileArg = process.argv.find(arg => arg.startsWith("--profile="))?.split("=")[1] || "default";
  const profile = AGENT_PROFILES.find(value => value === profileArg);
  if (!profile) throw new Error("模型选项无效：default、qwen-max 或 deepseek");
  const config = agentConfig(profile);
  if (!config.apiKey) throw new Error(`待配置：请在项目根目录 .env 填写 ${config.keyName}。没有发起模型调用。`);
  console.log(`配置已齐：${config.model}；密钥不输出。`);
  if (!process.argv.includes("--live")) {
    console.log("尚未验证真实模型。明确运行 npm run agent:verify -- --live 后，会调用模型并产生服务商用量；只使用临时测试资料，不发送现有业务库。");
    return;
  }
  const directory = mkdtempSync(path.join(tmpdir(), "yiju-agent-live-"));
  writeFileSync(path.join(directory, "verify.db"), "");
  process.env.DATABASE_URL = `file:${path.join(directory, "verify.db")}`;
  process.env.AGENT_MODE = "live";
  const { prisma, disconnectPrisma } = await import("../src/lib/db");
  try {
    console.log("正在建立隔离测试库");
    execFileSync(process.execPath, [path.resolve("node_modules/prisma/build/index.js"), "db", "push", "--skip-generate", "--schema", path.resolve("prisma/schema.prisma")], { env: process.env, stdio: "pipe" });
    console.log("正在填入仓库自带虚构样例");
    const { seedDatabase } = await import("../prisma/seed");
    await seedDatabase(prisma);
    const { IDS } = await import("../src/lib/constants");
    const { runBusinessAgent } = await import("../src/server/agents/business-agent");
    const { previewOrderAssistant, confirmOrderAssistant } = await import("../src/server/services/order-assistant");
    const actor = { organizationId: IDS.orgDemo, userId: IDS.userManager, role: "manager", factoryId: null };
    const cases = [
      ["order", "给北岸服饰建一个针织T恤订单，基础样已确认"],
      ["development", "找 ST-26018 圆领针织上衣的版型，说明面料工艺和参考理由"],
      ["scheduling", "DEMO-ORD-001 这个订单排给谁，解释理由"],
      ["finance", "北岸服饰还有哪些没对上的"],
      ["review", "ST-26018 这个版审过了吗"],
      ["workspace", "查2026年9月24日到9月30日交期的订单，核对资料、分色、料况和待办"],
    ] as const;
    await prisma.salesOrder.update({ where: { id: "order-demo-001" }, data: { status: "confirmed", requestedDeliveryDate: "2026-09-25" } });
    for (const [entry, text] of cases) {
      const before = await prisma.auditEvent.count();
      console.log(`正在验证：${entry}`);
      const result = await runBusinessAgent(actor, entry, text, undefined, profile);
      assert(result.evidenceRead, `${entry} 未读取详细业务依据`);
      assert(result.steps.length >= 2, `${entry} 没有完成查找和取证`);
      assert.equal(await prisma.auditEvent.count(), before + 1, "查询应只新增一条查询凭据");
      if (entry === "order") {
        const data = result.orderResult;
        assert(data?.candidates.length, "没有找到建单参考");
        const preview = await previewOrderAssistant(actor, { text: data.resolvedText, candidateId: data.candidates[0].id, idempotencyKey: "live-verification-confirm" });
        const created = await confirmOrderAssistant(actor, { proposalId: preview.proposalId, confirmed: true });
        assert.deepEqual(await confirmOrderAssistant(actor, { proposalId: preview.proposalId, confirmed: true }), created);
        const audit = await prisma.auditEvent.findFirstOrThrow({ where: { entityId: created.orderId, action: "order.assistant_draft_created" } });
        assert.equal(audit.actorUserId, actor.userId); assert(audit.createdAt); assert(JSON.parse(audit.payloadJson!).after.orderId);
      }
      console.log(`通过：${entry} · 自然语言触发真实工具查询${entry === "order" ? "、人工确认路径及审计" : ""}`);
    }
    console.log("LOCAL_OK：六个固定案例与建单审计通过；开放表达理解质量仍需业务人员验收。演示业务库未参与测试。");
  } finally { await disconnectPrisma(); rmSync(directory, { recursive: true, force: true }); }
}
main().catch(error => { console.error("失败类别：", error instanceof Error ? error.name : "Unknown"); console.error(error instanceof Error && !/prisma|SQL|Command failed/i.test(error.message) ? error.message : "验证失败，请检查配置或临时测试库初始化；未修改演示库。"); process.exitCode = 1; });
