import { test, expect } from "@playwright/test";

test("款式一条链：同一主档串起大货和销售样，不显示英文状态码", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("邮箱").fill("salesperson@demo.local");
  await page.getByLabel("密码").fill("DemoPass!2026");
  await page.getByRole("button", { name: "进入工作台" }).click();
  await expect(page).toHaveURL(/workspace/, { timeout: 15_000 });

  await page.goto("/styles");
  await expect(page.getByRole("button", { name: "新建主档" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "新建主档" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "工艺管理" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "制版管理" })).toHaveCount(0);
  await expect(page.getByText("sales_sample")).toHaveCount(0);
  await expect(page.getByText("含销售样").first()).toBeVisible();
  await expect(page.getByText("含大货").first()).toBeVisible();

  await expect(page.getByText("款号").first()).toBeVisible();
  await expect(page.getByText("客户品牌").first()).toBeVisible();
  await expect(page.getByText("订单 PO").first()).toBeVisible();
  await expect(page.getByText("北岸服饰").first()).toBeVisible();

  await page.getByText("ST-26018").click();
  await expect(page).toHaveURL(/styles\/style-st-26018/);
  await expect(page.getByText("款式一条链")).toBeVisible();
  await expect(page.getByText("款式主档")).toBeVisible();
  await expect(page.getByText("翻单不复制主档和照片")).toBeVisible();
  await expect(page.getByText("加色不是新款").first()).toBeVisible();
  await expect(page.getByText("大货", { exact: true })).toBeVisible();
  await expect(page.getByText("DEMO-ORD-001").first()).toBeVisible();
  await expect(page.getByText("NB-PO-2025-088").first()).toBeVisible();
  await expect(page.getByText("未挂季节").first()).toBeVisible();
  await expect(page.getByText("大货号未核实，不当主键")).toBeVisible();
  await expect(page.getByText("色路")).toBeVisible();
  await expect(page.getByText("海军蓝").first()).toBeVisible();
  await expect(page.getByText("不是新款").first()).toBeVisible();
  await expect(page.getByText("面辅料 1 行").first()).toBeVisible();
  await expect(page.getByText("MAT-001").first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "工艺与版次" })).toBeVisible();
  await expect(page.getByText("未记工艺说明，不能当生产依据").first()).toBeVisible();
  await expect(page.getByText("不是制版系统").first()).toBeVisible();
  await expect(page.getByText(/毛需求 MAT-001 1236 m/).first()).toBeVisible();

  await page.goto("/styles");
  await page.getByText("ST-26009").click();
  await expect(page.getByText("销售样", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("同一主款，不是新档")).toBeVisible();
  await expect(page.getByText("QL-S-01").first()).toBeVisible();
  await expect(page.getByText("建档时尚未写入面辅料").first()).toBeVisible();
});

test("材料架子挂在产品与开发，不按客户分文件夹", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("邮箱").fill("salesperson@demo.local");
  await page.getByLabel("密码").fill("DemoPass!2026");
  await page.getByRole("button", { name: "进入工作台" }).click();
  await expect(page).toHaveURL(/workspace/, { timeout: 15_000 });

  await page.goto("/styles?tab=materials");
  await expect(page.getByRole("button", { name: "新建材料" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "新建材料" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "面料采购" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "面料" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "纱线" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "辅料" })).toBeVisible();
  await expect(page.getByRole("link", { name: "MAT-001" })).toBeVisible();
  await expect(page.getByText("ST-26018").first()).toBeVisible();
  await expect(page.getByText("不按客户文件夹分")).toBeVisible();
  await expect(page.getByText("北岸服饰")).toHaveCount(0);
});

test("建档写入面辅料只进草稿，不覆盖已批准版本", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("邮箱").fill("salesperson@demo.local");
  await page.getByLabel("密码").fill("DemoPass!2026");
  await page.getByRole("button", { name: "进入工作台" }).click();
  await expect(page).toHaveURL(/workspace/, { timeout: 15_000 });

  await page.goto("/styles/style-st-26009");
  await expect(page.getByText("建档写入面辅料")).toBeVisible();
  await page.getByRole("checkbox", { name: /MAT-001/ }).check();
  await page.getByRole("button", { name: "写入资料草稿" }).click();
  await expect(page.getByText("未覆盖已批准版本").first()).toBeVisible();
  await expect(page.getByText("建档时尚未写入面辅料").first()).toBeVisible();
  await expect(page.getByText("用量待工厂确认").first()).toBeVisible();
  await expect(page.getByText("资料 第 2 版")).toBeVisible();

  await page.getByLabel("MAT-001 单耗").fill("1.5");
  await page.getByRole("button", { name: "写入资料草稿" }).click();
  await expect(page.getByText("口头").first()).toBeVisible();
  await expect(page.getByText(/MAT-001 单耗 1.5/).first()).toBeVisible();

  await page.goto("/orders/order-demo-001");
  await expect(page.getByRole("heading", { name: "本单毛需求" })).toBeVisible();
  await expect(page.getByText("毛需求 MAT-001 1236 m（规则计算，未扣库存，不是采购建议）")).toBeVisible();
});
