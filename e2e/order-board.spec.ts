import { test, expect } from "@playwright/test";

async function login(page: import("@playwright/test").Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("邮箱").fill(email);
  await page.getByLabel("密码").fill("DemoPass!2026");
  await page.getByRole("button", { name: "进入工作台" }).click();
  await expect(page).toHaveURL(/workspace/, { timeout: 15_000 });
}

test("订单执行列表展示客户下单有用列，没有裁片库存", async ({ page }) => {
  await login(page, "salesperson@demo.local");
  await page.goto("/orders");
  await expect(page.getByRole("columnheader", { name: "工厂" })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "缺什么" })).toBeVisible();
  await expect(page.getByText("裁片库存")).toHaveCount(0);
  await expect(page.getByText("待开裁")).toHaveCount(0);
  await page.getByLabel("检索").fill("DEMO-ORD-001");
  await page.getByRole("button", { name: "检索" }).click();
  await expect(page.getByRole("link", { name: "DEMO-ORD-001" })).toBeVisible();
  const row = page.getByRole("row").filter({ has: page.getByRole("link", { name: "DEMO-ORD-001" }) });
  await expect(row.getByText("海军蓝")).toBeVisible();
  await expect(row.getByText("云杉服装工厂")).toBeVisible();
});

test("生产进度台用面料/色卡列，不是开裁打卡", async ({ page }) => {
  await login(page, "manager@demo.local");
  await page.goto("/delivery");
  await expect(page.getByRole("columnheader", { name: "负责人" })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "进度" })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "面料" })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "色卡" })).toBeVisible();
  await expect(page.getByText("待开裁")).toHaveCount(0);
  await expect(page.getByText("裁床完成率")).toHaveCount(0);
  await page.getByLabel("检索").fill("DEMO-ORD-002");
  await page.getByRole("button", { name: "检索" }).click();
  await expect(page.getByText("物料到货待核验").first()).toBeVisible();
});
