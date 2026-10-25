import { test, expect } from "@playwright/test";

test("历史复用检索标记资料匹配且不是视觉识款", async ({ page }) => {
  await page.goto("/login");
  await page.getByRole("button", { name: "进入工作台" }).click();
  await expect(page).toHaveURL(/workspace/, { timeout: 15_000 });
  await page.goto("/styles?tab=reuse");
  await page.getByRole("button", { name: "检索历史资料" }).click();
  await expect(page.getByText("资料匹配").first()).toBeVisible();
  await expect(page.getByText("ST-26018").first()).toBeVisible();
  await expect(page.getByText("不是视觉识款")).toBeVisible();
  await expect(page.getByText("视觉识款", { exact: true })).toHaveCount(0);
  await expect(page.getByText("历史批准可直接沿用：否").first()).toBeVisible();
});
