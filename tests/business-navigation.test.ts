import { describe, expect, it } from "vitest";
import { businessHref, businessSectionForRoute, visibleBusinessNav } from "@/lib/business-navigation";

function section(url: string, follow?: "sales" | "bulk") {
  const parsed = new URL(url, "http://localhost");
  return businessSectionForRoute(parsed.pathname, parsed.searchParams, follow);
}

describe("按业务阶段导航，兼容原链接", () => {
  it("同一 orders 路径分清销售样、大货和生产订单，筛选不影响归属", () => {
    expect(section("/orders?sheet=sales&q=毛衣")).toBe("sales");
    expect(section("/orders?sheet=bulk&q=PO100515")).toBe("bulk");
    expect(section("/orders?view=orders&sheet=bulk")).toBe("production");
    expect(section("/orders?view=season")).toBe("bulk");
    expect(section("/orders", "bulk")).toBe("bulk");
    expect(section("/orders", "sales")).toBe("sales");
  });
  it("直接打开跟单或改单详情，采用服务器查到的阶段，不猜为生产单", () => {
    expect(section("/orders/follow/sample-1?row=2", "sales")).toBe("sales");
    expect(section("/orders/follow/bulk-1/changes", "bulk")).toBe("bulk");
    expect(section("/orders/follow/unknown")).toBeNull();
    expect(section("/orders/production-1/transfers")).toBe("production");
    expect(section("/orders/follow/print?sheet=sales")).toBe("sales");
    expect(section("/orders/follow/print")).toBe("bulk");
  });
  it("材料库、主档与原审批深链接各有归属，不误认相似路径", () => {
    expect(section("/styles?tab=materials")).toBe("resources");
    expect(section("/styles?tab=projects")).toBe("development");
    expect(section("/projects/project-1")).toBe("development");
    expect(section("/resources?locationId=factory-1")).toBe("resources");
    expect(section("/decisions/proposal-1")).toBe("workspace");
    expect(section("/orders-other")).toBeNull();
  });
  it("财务入口依授权显示，工厂不出现不能办理的客户来单入口", () => {
    expect(visibleBusinessNav("manager", true)).toHaveLength(8);
    expect(visibleBusinessNav("salesperson", false).some(item => item.id === "finance")).toBe(false);
    expect(visibleBusinessNav("salesperson", true).some(item => item.id === "finance")).toBe(true);
    expect(visibleBusinessNav("factory", false).some(item => item.id === "intake")).toBe(false);
    expect(visibleBusinessNav("factory", false).some(item => item.id === "production")).toBe(true);
  });
  it("一级入口直接到阶段总表；旧库存入口保留，资料首页另有明确地址", () => {
    expect(businessHref("sales")).toBe("/orders?sheet=sales");
    expect(businessHref("bulk")).toBe("/orders?sheet=bulk");
    expect(businessHref("development")).toBe("/styles?tab=projects");
    expect(businessHref("resources")).toBe("/resources?view=library");
  });
});
