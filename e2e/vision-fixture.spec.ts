import { test, expect } from "@playwright/test";

test("内置 fixture 图按公开文本解析，不是视觉识款", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("邮箱").fill("salesperson@demo.local");
  await page.getByLabel("密码").fill("DemoPass!2026");
  await page.getByRole("button", { name: "进入工作台" }).click();
  await expect(page).toHaveURL(/workspace/, { timeout: 15_000 });

  await page.goto("/inbox");
  await page.getByRole("button", { name: "录入资料" }).click();
  await page.getByLabel("附件").setInputFiles("fixtures/10-vision-reorder.png");
  await page.getByRole("button", { name: "保存附件" }).click();
  await expect(page).toHaveURL(/\/inbox\//, { timeout: 15_000 });
  await expect(page.getByText("不是视觉识款").first()).toBeVisible();
  await expect(page.getByText("ST-26018").first()).toBeVisible();
  await expect(page.getByText("视觉相似度")).toHaveCount(0);
});
