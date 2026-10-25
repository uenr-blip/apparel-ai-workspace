import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";

const SAMPLE = `给北岸服饰追加 ST-26018，沿用之前已确认的款式，海军蓝 600 件、灰色 400 件。袖口改为罗纹，总量 1000 件。希望 10 月 20 日交货，客户 PO 暂未提供。各尺码数量和罗纹规格稍后确认。`;
const AMENDMENT = readFileSync("fixtures/05-size-amendment.txt", "utf8");

async function login(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.getByLabel("邮箱").fill("salesperson@demo.local");
  await page.getByLabel("密码").fill("DemoPass!2026");
  await page.getByRole("button", { name: "进入工作台" }).click();
  await expect(page).toHaveURL(/workspace/, { timeout: 15_000 });
}

async function fillCell(page: import("@playwright/test").Page, color: string, size: string, qty: number) {
  await page.locator(`input[name="${color}-${size}"]`).fill(String(qty));
}

test("矩阵可保存完整色尺，罗纹待批准且不显示内部状态码", async ({ page }) => {
  await login(page);
  await page.goto("/inbox");
  await page.getByRole("button", { name: "录入资料" }).click();
  await page.locator('textarea[name="sourceText"]').fill(`${SAMPLE} 补尺码 ${Date.now()}`);
  await page.getByRole("button", { name: "保存并解析" }).click();
  await page.getByRole("button", { name: "批准创建草稿" }).click();
  await expect(page).toHaveURL(/orders\//, { timeout: 15_000 });
  await expect(page.getByText("保存色尺与规格")).toHaveCount(0);
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
  await expect(page.getByText("已完成 · 待补尺码")).toBeVisible();
  await expect(page.getByText("未完成 · 待确认罗纹")).toBeVisible();
  await expect(page.getByText("blocked_unapproved_spec")).toHaveCount(0);
  await expect(page.getByText("未完成 · 待确认交期年份")).toBeVisible();
  await page.getByRole("button", { name: "确认交期为 2026-10-20" }).click();
  await expect(page.getByText("已完成 · 待确认交期年份")).toBeVisible();
  await expect(page.getByText("2026-10-20").first()).toBeVisible();
  await page.reload();
  await expect(page.getByText("资料已保存，罗纹规格待批准").first()).toBeVisible();
  await expect(page.locator('input[name="海军蓝-XS"]')).toHaveValue("60");
});

test("合计不一致可留草稿；粘贴消息需确认才写入", async ({ page }) => {
  await login(page);
  await page.goto("/inbox");
  await page.getByRole("button", { name: "录入资料" }).click();
  await page.locator('textarea[name="sourceText"]').fill(`${SAMPLE} 不一致 ${Date.now()}`);
  await page.getByRole("button", { name: "保存并解析" }).click();
  await page.getByRole("button", { name: "批准创建草稿" }).click();
  await expect(page).toHaveURL(/orders\//, { timeout: 15_000 });
  await fillCell(page, "海军蓝", "M", 10);
  await page.getByRole("button", { name: "保存资料草稿" }).click();
  await expect(page.getByText("色尺数量尚未对齐").first()).toBeVisible();
  await expect(page.getByText("未完成 · 待补尺码")).toBeVisible();
  await expect(page.getByRole("button", { name: "保存资料草稿" })).toBeEnabled();
  await page.locator('textarea[name="amendmentText"]').fill(AMENDMENT);
  await expect(page.getByRole("button", { name: "提取待确认修改" })).toBeEnabled();
  await page.getByRole("button", { name: "提取待确认修改" }).click();
  await expect(page.getByText("未调用真实模型").first()).toBeVisible();
  await expect(page.getByText("原文摘出").first()).toBeVisible();
  await page.getByRole("button", { name: "确认写入提取结果" }).click();
  await expect(page.getByText("资料已保存，罗纹规格待批准").first()).toBeVisible();
  await page.reload();
  await expect(page.locator('input[name="海军蓝-XS"]')).toHaveValue("60");
});

test("非固定演示订单可补色尺，不自动套用演示配比", async ({ page }) => {
  await login(page);
  await page.goto("/orders");
  await page.getByRole("link", { name: "DEMO-ORD-002" }).click();
  await expect(page).toHaveURL(/orders\//);
  await expect(page.locator('input[name="海军蓝-XS"]')).toHaveValue("");
  await fillCell(page, "海军蓝", "M", 1000);
  await page.getByRole("button", { name: "保存资料草稿" }).click();
  await expect(page.getByText("资料已保存").first()).toBeVisible();
  await expect(page.getByText("材料未齐").first()).toBeVisible();
  await page.reload();
  await expect(page.locator('input[name="海军蓝-M"]')).toHaveValue("1000");
  await expect(page.locator('input[name="海军蓝-XS"]')).toHaveValue("");
  await expect(page.getByText("材料未齐").first()).toBeVisible();
});
