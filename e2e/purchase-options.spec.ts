import { test, expect } from "@playwright/test";

test("DEMO-ORD-002 净需求方案 A/B 可见且未下达采购", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("邮箱").fill("manager@demo.local");
  await page.getByLabel("密码").fill("DemoPass!2026");
  await page.getByRole("button", { name: "进入工作台" }).click();
  await expect(page).toHaveURL(/workspace/, { timeout: 15_000 });

  await page.goto("/orders");
  await page.getByRole("link", { name: "DEMO-ORD-002" }).click();
  await expect(page.getByRole("heading", { name: "净需求与余料方案" })).toBeVisible();
  await expect(page.getByText("未下达采购").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "下达采购" })).toHaveCount(0);
  const adoptA = page.getByRole("button", { name: "采用方案 A" });
  if ((await adoptA.count()) > 0) {
    await expect(page.getByText(/净需求 \d+/).first()).toBeVisible();
    await adoptA.click();
  }
  await expect(page.getByText(/已采用方案 A/).first()).toBeVisible();
  await expect(page.getByText(/采购草稿 \d+/).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "下达采购" })).toHaveCount(0);
});
