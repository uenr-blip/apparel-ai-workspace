import { test, expect } from "@playwright/test";

test("款式详情可换图，不识款、不新建款", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("邮箱").fill("salesperson@demo.local");
  await page.getByLabel("密码").fill("DemoPass!2026");
  await page.getByRole("button", { name: "进入工作台" }).click();
  await expect(page).toHaveURL(/workspace/, { timeout: 15_000 });

  await page.goto("/styles/style-st-26018");
  await expect(page.getByText("保存款式图")).toBeVisible();
  await expect(page.getByText("不会识款")).toBeVisible();
  await expect(page.getByText("不必先填品牌、品类或年份")).toBeVisible();

  await page.getByLabel("款式图").setInputFiles("fixtures/style-image-1x1.png");
  await page.getByRole("button", { name: "保存款式图" }).click();
  await expect(page.getByText("已换图，未识款，不是新款")).toBeVisible();
  await expect(page.getByText("ST-26018").first()).toBeVisible();
  await expect(page.getByRole("heading", { name: /圆领/ })).toBeVisible();
});
