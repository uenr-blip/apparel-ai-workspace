import { test, expect } from "@playwright/test";

test("口头翻单先出任务卡，不自动建单", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("邮箱").fill("salesperson@demo.local");
  await page.getByLabel("密码").fill("DemoPass!2026");
  await page.getByRole("button", { name: "进入工作台" }).click();
  await expect(page).toHaveURL(/workspace/, { timeout: 15_000 });

  await page.goto("/inbox");
  await page.getByRole("button", { name: "录入资料" }).click();
  await page.getByRole("button", { name: "填入口头翻单缺项" }).click();
  await page.getByRole("button", { name: "保存并解析" }).click();
  await expect(page).toHaveURL(/\/inbox\//, { timeout: 15_000 });
  await expect(page.getByText("可处理任务")).toBeVisible();
  await expect(page.getByText("已找到 2 份可能相关的历史资料，需要你选择。")).toBeVisible();
  await expect(page.getByText("新颜色尚未确认，不能沿用旧样品批准。")).toBeVisible();
  await expect(page.getByText("尺码未齐，暂不形成完整数量明细。")).toBeVisible();
  await expect(page.getByText("ST-26018")).toBeVisible();
  await expect(page.getByRole("button", { name: "选定这份资料" })).toBeVisible();
  await expect(page.getByText("将创建：")).toHaveCount(0);
});
