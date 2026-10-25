import { test, expect } from "@playwright/test";

test("产品与开发可新建主档，不先填品牌年份，不另开工艺菜单", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("邮箱").fill("salesperson@demo.local");
  await page.getByLabel("密码").fill("DemoPass!2026");
  await page.getByRole("button", { name: "进入工作台" }).click();
  await expect(page).toHaveURL(/workspace/, { timeout: 15_000 });

  await page.goto("/styles");
  await page.getByRole("button", { name: "新建主档" }).click();
  await page.getByLabel("款号").fill("ST-E2E-01");
  await page.getByLabel("款名").fill("验收新建圆领");
  await page.getByRole("dialog").getByRole("button", { name: "新建主档" }).click();
  await expect(page).toHaveURL(/\/styles\//, { timeout: 15_000 });
  await expect(page.getByText("ST-E2E-01").first()).toBeVisible();
  await expect(page.getByText("未填写").first()).toBeVisible();
  await expect(page.getByText("未记工艺说明，不能当生产依据").first()).toBeVisible();
  await expect(page.getByRole("link", { name: "工艺管理" })).toHaveCount(0);

  await page.getByPlaceholder("缝制要点、特殊工艺。不要填标准工时。").fill("圆领先合肩。不是工时。");
  await page.getByPlaceholder("例如 P2").fill("P1");
  await page.getByRole("button", { name: "保存到资料草稿" }).click();
  await expect(page.getByText("工艺说明已记，不是标准工时").first()).toBeVisible();
  await expect(page.getByText("版次 P1").first()).toBeVisible();
});
