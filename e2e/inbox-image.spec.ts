import { test, expect } from "@playwright/test";

test("收件箱图片只保存不识款、不编 BOM", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("邮箱").fill("salesperson@demo.local");
  await page.getByLabel("密码").fill("DemoPass!2026");
  await page.getByRole("button", { name: "进入工作台" }).click();
  await expect(page).toHaveURL(/workspace/, { timeout: 15_000 });

  await page.goto("/inbox");
  await page.getByRole("button", { name: "录入资料" }).click();
  await expect(page.getByRole("heading", { name: "上传表格、PDF 或图片" })).toBeVisible();
  await page.getByLabel("附件").setInputFiles("fixtures/style-image-1x1.png");
  await page.getByRole("button", { name: "保存附件" }).click();
  await expect(page).toHaveURL(/\/inbox\//, { timeout: 15_000 });
  await expect(page.getByText("请改用粘贴邮件或文本进单")).toBeVisible();
  await expect(page.getByText("未识款，没有操作提案")).toBeVisible();
  await expect(page.getByText("将创建：")).toHaveCount(0);
});
