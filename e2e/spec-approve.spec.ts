import { test, expect } from "@playwright/test";

const SAMPLE = `给北岸服饰追加 ST-26018，沿用之前已确认的款式，海军蓝 600 件、灰色 400 件。袖口改为罗纹，总量 1000 件。希望 10 月 20 日交货，客户 PO 暂未提供。各尺码数量和罗纹规格稍后确认。`;

async function login(page: import("@playwright/test").Page, email: string) {
  await page.request.post("/api/auth/logout");
  await page.goto("/login");
  await page.getByLabel("邮箱").fill(email);
  await page.getByLabel("密码").fill("DemoPass!2026");
  await page.getByRole("button", { name: "进入工作台" }).click();
  await expect(page).toHaveURL(/workspace/, { timeout: 15_000 });
}

async function fillCell(page: import("@playwright/test").Page, color: string, size: string, qty: number) {
  await page.locator(`input[name="${color}-${size}"]`).fill(String(qty));
}

test("业务员不能批规格；经理批准后不覆盖历史版本且不开通投产", async ({ page }) => {
  await login(page, "salesperson@demo.local");
  await page.goto("/inbox");
  await page.getByRole("button", { name: "录入资料" }).click();
  await page.locator('textarea[name="sourceText"]').fill(`${SAMPLE} 规格批准 ${Date.now()}`);
  await page.getByRole("button", { name: "保存并解析" }).click();
  await page.getByRole("button", { name: "批准创建草稿" }).click();
  await expect(page).toHaveURL(/orders\//, { timeout: 15_000 });
  await fillCell(page, "海军蓝", "XS", 60);
  await fillCell(page, "海军蓝", "S", 120);
  await fillCell(page, "海军蓝", "M", 240);
  await fillCell(page, "海军蓝", "L", 120);
  await fillCell(page, "海军蓝", "XL", 60);
  await fillCell(page, "灰色", "XS", 40);
  await fillCell(page, "灰色", "S", 80);
  await fillCell(page, "灰色", "M", 160);
  await fillCell(page, "灰色", "L", 80);
  await fillCell(page, "灰色", "XL", 40);
  await page.locator('input[name="ribSpec"]').fill("2x2 罗纹，克重与缩水待测");
  await page.getByRole("button", { name: "保存资料草稿" }).click();
  await expect(page.getByText("资料已保存，罗纹规格待批准").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "批准本单资料版本" })).toBeDisabled();
  await expect(page.getByText("当前角色无权批准资料版本")).toBeVisible();
  const orderUrl = page.url();

  await login(page, "manager@demo.local");
  await page.goto(orderUrl);
  await page.getByRole("button", { name: "批准本单资料版本" }).click();
  await expect(page.getByText("资料版本已批准").first()).toBeVisible();
  await expect(page.getByText("已完成 · 待确认罗纹")).toBeVisible();
  await expect(page.getByText("投产尚未开放").first()).toBeVisible();
  await page.reload();
  await expect(page.getByText("本单资料版本已批准").first()).toBeVisible();
  await expect(page.getByText("ready_for_production")).toHaveCount(0);
});
