import { test, expect } from "@playwright/test";

test("分色确认：灰色退回保留，第二轮批准不覆盖历史，不显示整款已批准", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("邮箱").fill("salesperson@demo.local");
  await page.getByLabel("密码").fill("DemoPass!2026");
  await page.getByRole("button", { name: "进入工作台" }).click();
  await expect(page).toHaveURL(/workspace/, { timeout: 15_000 });

  await page.goto("/orders/order-demo-004");
  await expect(page.getByRole("heading", { name: "分色确认" })).toBeVisible();
  await expect(page.getByText("海军蓝已批准")).toBeVisible();
  await expect(page.getByText("灰色第 1 轮退回")).toBeVisible();
  await expect(page.getByText("整款已批准")).toHaveCount(0);
  await expect(page.getByText("手感不符退回")).toBeVisible();
  await expect(page.getByText("不是图片识别终审")).toBeVisible();

  await page.getByLabel("灰色确认依据").fill("第二轮色样通过，手感已改");
  await page.getByRole("button", { name: "批准灰色" }).click();
  await expect(page.getByText("各色最新一轮均已批准").first()).toBeVisible();
  await expect(page.getByText("第 1 轮 已退回：手感不符退回")).toBeVisible();
  await expect(page.getByText("第 2 轮 已批准：第二轮色样通过，手感已改")).toBeVisible();
  await expect(page.getByText("整款已批准")).toHaveCount(0);
  await expect(page.getByText("分色已确认，不能投产").first()).toBeVisible();
});
