import { test, expect } from "@playwright/test";

test("资源中心可调拨领用，不另开面料采购菜单", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("邮箱").fill("manager@demo.local");
  await page.getByLabel("密码").fill("DemoPass!2026");
  await page.getByRole("button", { name: "进入工作台" }).click();
  await expect(page).toHaveURL(/workspace/, { timeout: 15_000 });

  await page.goto("/resources");
  await page.getByRole("button", { name: "调拨或领用" }).click();
  await expect(page.getByRole("heading", { name: "调拨与领用" })).toBeVisible();
  await expect(page.getByRole("button", { name: "确认调拨" })).toBeVisible();
  await expect(page.getByText("MAT-D06").first()).toBeVisible();
  await expect(page.getByText("原料库").first()).toBeVisible();
  await expect(page.getByRole("link", { name: "面料采购" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "物料库存" })).toHaveCount(0);
  await page.getByRole("button", { name: "关闭调拨与领用", exact: true }).click();
  await page.getByRole("link", { name: "云杉服装工厂", exact: true }).click();
  await expect(page).toHaveURL(/resources\/parties\//);
  await expect(page.getByText("派给这家工厂的订单")).toBeVisible();
});
