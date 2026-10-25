import { test, expect } from "@playwright/test";

test("CSV 提取可定位到单元格，不是识款", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("邮箱").fill("salesperson@demo.local");
  await page.getByLabel("密码").fill("DemoPass!2026");
  await page.getByRole("button", { name: "进入工作台" }).click();
  await expect(page).toHaveURL(/workspace/, { timeout: 15_000 });

  await page.goto("/inbox");
  await page.getByRole("button", { name: "录入资料" }).click();
  await page.getByLabel("附件").setInputFiles("fixtures/07-reorder.csv");
  await page.getByRole("button", { name: "保存附件" }).click();
  await expect(page).toHaveURL(/\/inbox\//, { timeout: 15_000 });
  await expect(page.getByText("Sheet1!A2").first()).toBeVisible();
  await expect(page.getByText("ST-26018").first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Sheet1!A2" })).toBeVisible();
  await expect(page.getByText("未识款，没有操作提案")).toHaveCount(0);
});
