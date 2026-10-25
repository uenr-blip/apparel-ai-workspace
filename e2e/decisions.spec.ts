import { test, expect } from "@playwright/test";

test("决策中心可筛选且能打开详情，不是审批流菜单", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("邮箱").fill("manager@demo.local");
  await page.getByLabel("密码").fill("DemoPass!2026");
  await page.getByRole("button", { name: "进入工作台" }).click();
  await expect(page).toHaveURL(/workspace/, { timeout: 15_000 });

  await page.goto("/decisions");
  await expect(page.getByRole("heading", { name: "决策中心" })).toBeVisible();
  await expect(page.getByRole("link", { name: "待批准" })).toBeVisible();
  await expect(page.getByRole("link", { name: "已拒绝" })).toBeVisible();
  await expect(page.getByRole("link", { name: "已过期" })).toBeVisible();
  await expect(page.getByRole("link", { name: "审批流" })).toHaveCount(0);
});
