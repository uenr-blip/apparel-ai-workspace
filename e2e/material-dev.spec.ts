import { test, expect } from "@playwright/test";

test("材料开发：无款号批准后进入开发款式", async ({ page }) => {
  await page.goto("/login");
  await page.getByRole("button", { name: "进入工作台" }).click();
  await expect(page).toHaveURL(/workspace/, { timeout: 15_000 });
  await page.goto("/inbox");
  await page.getByRole("button", { name: "录入资料" }).click();
  await page.getByRole("button", { name: "填入材料开发示例" }).click();
  const textarea = page.locator('textarea[name="sourceText"]');
  const current = await textarea.inputValue();
  await textarea.fill(`${current}\n批次 ${Date.now()}`);
  await page.getByRole("button", { name: "保存并解析" }).click();
  await expect(page.getByText("YARN-DEMO-01").first()).toBeVisible();
  await expect(page.getByText("材料开发可先于款号")).toBeVisible();
  await page.getByRole("button", { name: "批准创建开发款式" }).click();
  await expect(page).toHaveURL(/projects\//, { timeout: 15_000 });
  await expect(page.getByText("尚未关联款号").first()).toBeVisible();
  await expect(page.getByText("YARN-DEMO-01").first()).toBeVisible();
  await expect(page.getByText("copyMode=reference")).toBeVisible();
});
