import { test, expect } from "@playwright/test";

async function login(page: import("@playwright/test").Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("邮箱").fill(email);
  await page.getByLabel("密码").fill("DemoPass!2026");
  await page.getByRole("button", { name: "进入工作台" }).click();
  await expect(page).toHaveURL(/workspace/, { timeout: 15_000 });
}

test("订单列表可按订单号检索", async ({ page }) => {
  await login(page, "salesperson@demo.local");
  await page.goto("/orders");
  await page.getByLabel("检索").fill("DEMO-ORD-005");
  await page.getByRole("button", { name: "检索" }).click();
  await expect(page).toHaveURL(/q=DEMO-ORD-005/);
  await expect(page.getByRole("link", { name: "DEMO-ORD-005" })).toBeVisible();
  await expect(page.getByRole("link", { name: "DEMO-ORD-001" })).toHaveCount(0);
});

test("款式列表可按款号检索", async ({ page }) => {
  await login(page, "salesperson@demo.local");
  await page.goto("/styles");
  await page.getByLabel("检索").fill("ST-26018");
  await page.getByRole("button", { name: "检索" }).click();
  await expect(page.getByText("ST-26018").first()).toBeVisible();
  await expect(page.getByText("ST-26009")).toHaveCount(0);
});
