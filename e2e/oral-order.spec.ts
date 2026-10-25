import { test, expect } from "@playwright/test";

async function login(page: import("@playwright/test").Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("邮箱").fill(email);
  await page.getByLabel("密码").fill("DemoPass!2026");
  await page.getByRole("button", { name: "进入工作台" }).click();
  await expect(page).toHaveURL(/workspace/, { timeout: 15_000 });
}

test("订单页可口头建草稿，不走收件箱批准", async ({ page }) => {
  await login(page, "salesperson@demo.local");
  await page.goto("/orders");
  await page.getByRole("button", { name: "口头建单" }).click();
  await expect(page.getByRole("heading", { name: "口头建单" })).toBeVisible();
  await page.locator('select[name="customerId"]').selectOption({ label: "北岸服饰" });
  await page.locator('select[name="styleId"]').selectOption({ label: "ST-26018 圆领针织上衣" });
  await page.getByLabel("颜色 1").fill("海军蓝");
  await page.getByLabel("海军蓝 件数").fill("120");
  await page.getByLabel("颜色 2").fill("灰色");
  await page.getByLabel("灰色 件数").fill("80");
  await page.getByRole("button", { name: "创建口头单草稿" }).click();
  await expect(page).toHaveURL(/\/orders\/.+/, { timeout: 15_000 });
  await expect(page.getByText("口头单草稿").first()).toBeVisible();
  await expect(page.getByText("规格不全，不能投产").first()).toBeVisible();
  await expect(page.getByText("海军蓝").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "保存资料草稿" })).toBeVisible();
});

test("工厂看不到口头建单", async ({ page }) => {
  await login(page, "factory@demo.local");
  await page.goto("/orders");
  await expect(page.getByRole("button", { name: "口头建单" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "口头建单" })).toHaveCount(0);
  await expect(page.getByText("当前角色不能建单")).toBeVisible();
});
