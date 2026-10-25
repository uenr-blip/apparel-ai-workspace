/** @vitest-environment jsdom */
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentResultTable } from "@/components/agent-result-table";
import { CreateFollowSheetForm } from "@/app/(app)/orders/create-follow-sheet-form";
import { BusinessAgentEntry } from "@/components/business-agent-entry";
import { AGENT_RESULT_VERSION } from "@/lib/agent-table";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/components/catalog-compose", () => ({ CatalogCompose: ({ children }: { children: ReactNode }) => createElement("div", null, children) }));
let root: Root, host: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

describe("助手业务表格与人工确认", () => {
  it("保留零值、缺失状态和原单入口，资料文字不能当 HTML 执行", async () => {
    await act(() => root.render(createElement(AgentResultTable, { table: { title: "核对结果", columns: ["订单", "已出运", "交期", "说明"], rows: [{ href: "/orders/test", cells: ["测试订单", 0, null, '<img src=x onerror="alert(1)">'] }], emptyMessage: "没有匹配记录" } })));
    expect(host.querySelector("caption")?.textContent).toBe("核对结果");
    expect([...host.querySelectorAll("tbody td")].map(td => td.textContent)).toEqual(["0", "未记录", '<img src=x onerror="alert(1)">']);
    expect(host.querySelector("img")).toBeNull();
    expect(host.querySelector("a")?.getAttribute("href")).toBe("/orders/test");
  });
  it("空结果显示查询范围限制，不显示零欠款或无风险", async () => {
    await act(() => root.render(createElement(AgentResultTable, { table: { title: "查询范围", columns: ["订单", "交期"], rows: [], notes: ["未确认交期的订单未纳入"], emptyMessage: "本次范围没有记录，不代表没有风险" } })));
    expect(host.querySelector("table")).toBeNull();
    expect(host.textContent).toContain("本次范围没有记录，不代表没有风险");
    expect(host.textContent).toContain("未确认交期的订单未纳入");
  });
  it("结论、缺项及下一步直接展示，不把空查询包装成成功表格", async () => {
    await act(() => root.render(createElement(AgentResultTable, { table: {
      title: "本周交期核对", columns: ["订单"], rows: [], emptyMessage: "没有匹配订单",
      conclusion: { tone: "incomplete", title: "暂时无法判断交期风险", detail: "4 张订单未确认交期", nextStep: "先补齐交期" },
    } })));
    expect(host.querySelector('[role="status"]')?.textContent).toContain("暂时无法判断交期风险");
    expect(host.textContent).toContain("4 张订单未确认交期");
    expect(host.textContent).toContain("下一步：先补齐交期");
    expect(host.querySelector("thead")).toBeNull();
  });
  it("草稿表可修改，但改后旧确认失效；生成与修改不自动写入", async () => {
    const network = vi.fn(); vi.stubGlobal("fetch", network);
    await act(() => root.render(createElement(CreateFollowSheetForm, { suggestion: { kind: "bulk", title: "SS27 大货", seasonCode: "SS27", factoryName: "测试工厂" }, assistantTicket: "test-ticket" })));
    expect(host.querySelector("caption")?.textContent).toContain("尚未保存");
    const submit = host.querySelector<HTMLButtonElement>('button[type="submit"]')!;
    const confirm = host.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    expect(submit.disabled).toBe(true);
    await act(() => confirm.click());
    expect(submit.disabled).toBe(false);
    const kind = host.querySelector("select")!;
    await act(() => { kind.value = "sales_sample"; kind.dispatchEvent(new Event("change", { bubbles: true })); });
    expect(confirm.checked).toBe(false);
    expect(submit.disabled).toBe(true);
    expect(host.textContent).not.toContain("工厂");
    expect(network).not.toHaveBeenCalled();
  });
  it.each([true, false])("交期入口旧结论拦截=%s，新结果直接显示缺项和原单入口", async legacy => {
    const result = {
      resultVersion: legacy ? undefined : AGENT_RESULT_VERSION, runId: "test-query", evidenceRead: true,
      answer: legacy ? "因此不存在交期风险" : "暂时无法判断交期风险", steps: ["按交期查订单"], cards: [],
      context: { platformVersion: "yiju-context-1.3.1", references: [] }, status: { label: "本地协议验证" },
      tables: [{ title: "交期与执行核对", columns: ["订单"], rows: [], emptyMessage: "没有匹配订单", conclusion: legacy ? undefined : { tone: "incomplete", title: "暂时无法判断交期风险", detail: "4 张订单未确认交期", nextStep: "点订单号补齐交期" } },
        ...legacy ? [] : [{ title: "交期待补齐", columns: ["订单"], rows: [{ cells: ["DEMO-ORD-004"], href: "/orders/order-demo-004#prep" }], emptyMessage: "没有缺项" }]],
    };
    const fetcher = vi.fn(async (_url, options) => ({ ok: true, json: async () => options?.method === "POST" ? result : { label: "测试配置" } }));
    vi.stubGlobal("fetch", fetcher);
    await act(() => root.render(createElement(BusinessAgentEntry, { module: "workspace", initialText: "本周订单风险" })));
    await act(async () => { [...host.querySelectorAll("button")].find(b => b.textContent === "开始核对")!.click(); });
    expect(host.textContent).not.toContain("因此不存在交期风险");
    expect(host.textContent).not.toContain("已列成业务表格");
    if (legacy) expect(host.textContent).toContain("核对规则已更新");
    else {
      expect(host.textContent).toContain("暂时无法判断交期风险");
      expect(host.textContent).toContain("4 张订单未确认交期");
      expect(host.querySelector('a[href="/orders/order-demo-004#prep"]')).not.toBeNull();
      expect(host.textContent).toContain("不是“通过”或“无风险”的评级");
    }
  });
});
