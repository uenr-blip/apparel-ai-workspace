import { test, expect } from "@playwright/test";

async function login(page: import("@playwright/test").Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("邮箱").fill(email);
  await page.getByLabel("密码").fill("DemoPass!2026");
  await page.getByRole("button", { name: "进入工作台" }).click();
  await expect(page).toHaveURL(/workspace/, { timeout: 15_000 });
}

test("生产进度台显示 DEMO-ORD-005 余货 15，不出现工序百分比", async ({ page }) => {
  await login(page, "manager@demo.local");
  await page.goto("/delivery");
  await expect(page.getByRole("heading", { name: "生产进度台" })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "负责人" })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "进度" })).toBeVisible();
  await expect(page.getByRole("link", { name: /余货未发/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /未投产/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /待装箱/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /有报废/ })).toBeVisible();
  await expect(page.getByText("裁床单")).toHaveCount(0);
  await expect(page.getByText("车间交货")).toHaveCount(0);
  await expect(page.getByRole("link", { name: /卡面料/ })).toBeVisible();
  await page.getByRole("link", { name: /卡面料/ }).click();
  await expect(page).toHaveURL(/view=fabric/);
  await expect(page.getByText("物料到货待核验").first()).toBeVisible();
  await page.getByRole("link", { name: /全部/ }).click();
  await expect(page.getByText("进度不是完成率")).toBeVisible();
  await expect(page.getByRole("link", { name: "DEMO-ORD-005" })).toBeVisible();
  await expect(page.getByText("余货未发完").first()).toBeVisible();
  await expect(page.getByText(/余货 15 件 = 合格 995/)).toBeVisible();
  await expect(page.getByText("物料到货待核验").first()).toBeVisible();
  await expect(page.getByText("裁床完成率")).toHaveCount(0);
  await expect(page.getByText("标准工时")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "装箱完成" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "下达采购" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "登记产量" })).toBeVisible();
  await expect(page.getByLabel("海军蓝 S件数")).toBeVisible();
  await expect(page.getByText("按本单颜色 × 尺码填")).toBeVisible();
  await expect(page.getByRole("button", { name: "保存装箱草稿" })).toBeVisible();
  await expect(page.getByRole("link", { name: "去财务核对" }).first()).toBeVisible();
  await expect(page.getByText("对账草稿不是付款")).toBeVisible();
  await expect(page.getByRole("button", { name: "付款" })).toHaveCount(0);
  await page.getByRole("button", { name: "DEMO-ORD-005 装箱" }).click();
  const packing = page.getByRole("dialog", { name: "DEMO-ORD-005 装箱" });
  await expect(packing).toBeVisible();
  await expect(packing.getByText("已出运 · 980 件")).toBeVisible();
  await expect(packing.getByText("待称重").first()).toBeVisible();
  await expect(packing.getByText("海军蓝").first()).toBeVisible();
  await expect(packing.getByText("灰色").first()).toBeVisible();
  await packing.getByRole("button", { name: "关闭装箱弹窗" }).click();
  await expect(packing).toHaveCount(0);
  await page.getByRole("button", { name: "DEMO-ORD-001 色尺" }).click();
  const dialog = page.getByRole("dialog", { name: "DEMO-ORD-001 色尺" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("海军蓝")).toBeVisible();
  await expect(dialog.getByText("M", { exact: true }).first()).toBeVisible();
  await expect(dialog.getByText("不是开裁/车间/后整件数")).toBeVisible();
  await expect(dialog.getByRole("columnheader", { name: "订单" })).toBeVisible();
  await expect(dialog.getByRole("columnheader", { name: "投产" })).toBeVisible();
  await expect(dialog.getByRole("columnheader", { name: "开裁" })).toHaveCount(0);
  await expect(dialog.getByRole("columnheader", { name: "车间" })).toHaveCount(0);
  await dialog.getByRole("button", { name: "关闭色尺弹窗" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("工厂只看本厂订单；390 宽表局部滚动", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page, "factory@demo.local");
  await page.goto("/delivery");
  await expect(page.getByRole("heading", { name: "生产进度台" })).toBeVisible();
  await expect(page.getByRole("link", { name: "DEMO-ORD-005" })).toBeVisible();
  await expect(page.getByText("ISO-ORD-001")).toHaveCount(0);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(8);
});
