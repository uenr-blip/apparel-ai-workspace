import { test, expect } from "@playwright/test";

const SAMPLE = `给北岸服饰追加 ST-26018，沿用之前已确认的款式，海军蓝 600 件、灰色 400 件。袖口改为罗纹，总量 1000 件。希望 10 月 20 日交货，客户 PO 暂未提供。各尺码数量和罗纹规格稍后确认。`;

test("翻单主闭环：登录、粘贴、批准、打开订单", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("邮箱").fill("salesperson@demo.local");
  await page.getByLabel("密码").fill("DemoPass!2026");
  await page.getByRole("button", { name: "进入工作台" }).click();
  await expect(page).toHaveURL(/workspace/, { timeout: 15_000 });
  await page.goto("/inbox");
  await page.getByRole("button", { name: "录入资料" }).click();
  await page.locator('textarea[name="sourceText"]').fill(`${SAMPLE} 批次 ${Date.now()}`);
  await page.getByRole("button", { name: "保存并解析" }).click();
  await expect(page.getByText("ST-26018").first()).toBeVisible();
  await expect(page.getByText("演示模式，未调用真实模型")).toBeVisible();
  await expect(page.locator("dl").getByText("尺码明细")).toBeVisible();
  await page.getByRole("button", { name: "批准创建草稿" }).click();
  await expect(page).toHaveURL(/orders\//, { timeout: 15_000 });
  await expect(page.getByText("规格不全，不能投产")).toBeVisible();
  await expect(page.getByText("空").first()).toBeVisible();
  await page.reload();
  await expect(page.getByText("规格不全，不能投产")).toBeVisible();
});
