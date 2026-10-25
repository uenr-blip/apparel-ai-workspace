import { test, expect } from "@playwright/test";

const EMAIL_SAMPLE = `From: Northshore Apparel <buying@northshore.example>
To: sales@demo.local
Subject: Repeat ST-26018 — cuff change, PO later

Please repeat ST-26018, same confirmed style as last time.
Navy 600 pcs, Grey 400 pcs, total 1000 pcs.
Change cuffs to rib.
Delivery: 20 October.
Customer PO not yet provided.
Size breakdown and rib spec to follow.`;

test("英文翻单邮件：粘贴、识别、批准、不能投产", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("邮箱").fill("salesperson@demo.local");
  await page.getByLabel("密码").fill("DemoPass!2026");
  await page.getByRole("button", { name: "进入工作台" }).click();
  await expect(page).toHaveURL(/workspace/, { timeout: 15_000 });
  await page.goto("/inbox");
  await page.getByRole("button", { name: "录入资料" }).click();
  await page.locator('textarea[name="sourceText"]').fill(`${EMAIL_SAMPLE}\nbatch ${Date.now()}`);
  await page.getByRole("button", { name: "保存并解析" }).click();
  await expect(page.getByText("ST-26018").first()).toBeVisible();
  await expect(page.getByText("演示模式，未调用真实模型")).toBeVisible();
  await expect(page.getByText("北岸服饰").first()).toBeVisible();
  await expect(page.getByText("英文来源对照演示客户北岸服饰，未新建客户")).toBeVisible();
  await expect(page.getByText("依据：Northshore Apparel")).toBeVisible();
  await expect(page.locator("dl").getByText("尺码明细")).toBeVisible();
  await page.getByRole("button", { name: "批准创建草稿" }).click();
  await expect(page).toHaveURL(/orders\//, { timeout: 15_000 });
  await expect(page.getByText("规格不全，不能投产")).toBeVisible();
});
