/** @vitest-environment jsdom */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { FollowEditProvider, useFollowEditState } from "@/app/(app)/orders/follow-edit-state";
import { OpenFollowOrder } from "@/app/(app)/orders/open-follow-order";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
let root: Root, host: HTMLDivElement;
const row = { id: "r1", label: "圆领", po: "PO1", shipDate: "2026-10-01", quantity: 12, registered: true, order: null };
const props = { sheetId: "s", expectedUpdatedAt: "v1", initialCustomerId: "c1", customers: [{ id: "c1", label: "客户" }], rows: [row, { ...row, id: "r2", label: "卫衣" }], order: null };
function button(text: string) { return [...host.querySelectorAll("button")].find(b => b.textContent?.includes(text))!; }
beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(() => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it("同 PO 同交期可选整表，必须明确核对；刷新资料使旧确认失效", async () => {
  const network = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ orderId: "o", orderNo: "O1" }) }); vi.stubGlobal("fetch", network);
  await act(() => root.render(createElement(OpenFollowOrder, props)));
  await act(() => button("选择整表（2 款）").click());
  expect(host.querySelectorAll('tbody input:checked')).toHaveLength(2);
  expect(button("将所选").disabled).toBe(true);
  await act(() => host.querySelector<HTMLInputElement>('[aria-label="确认本次开单范围"]')!.click());
  expect(button("将所选").disabled).toBe(false);
  await act(() => root.render(createElement(OpenFollowOrder, { ...props, expectedUpdatedAt: "v2" })));
  expect(button("将所选").disabled).toBe(true);
  await act(() => host.querySelector<HTMLInputElement>('[aria-label="确认本次开单范围"]')!.click());
  await act(() => button("将所选").click());
  expect(network).toHaveBeenCalledTimes(1);
  expect(JSON.parse(network.mock.calls[0][1].body)).toMatchObject({ rowIds: ["r1", "r2"], expectedUpdatedAt: "v2", customerId: "c1" });
  expect(host.textContent).toContain("已开 O1");
});
it("不同 PO 或交期必须分组，缺款式及件数不可勾选", async () => {
  await act(() => root.render(createElement(OpenFollowOrder, { ...props, rows: [row, { ...row, id: "r2", po: "PO2", shipDate: "2026-11-01" }, { ...row, id: "r3", registered: false }, { ...row, id: "r4", quantity: 0 }] })));
  expect(host.textContent).not.toContain("选择整表");
  expect(host.querySelectorAll('tbody input:disabled')).toHaveLength(2);
  for (const input of [...host.querySelectorAll<HTMLInputElement>('tbody input:not(:disabled)')]) await act(() => input.click());
  expect(host.textContent).toContain("所选含不同 PO");
  expect(host.textContent).toContain("所选交期不同");
  expect(button("将所选").disabled).toBe(true);
});

it("保存后等待服务器回查，不能拿旧款式列表立即开单", async () => {
  function SaveSignal() { const editing = useFollowEditState(); return createElement("button", { onClick: () => editing?.saved("2026-09-27T08:00:01.000Z") }, "模拟保存成功"); }
  const render = (stamp: string) => createElement(
    FollowEditProvider,
    // The required children are supplied through createElement's child arguments.
    { expectedUpdatedAt: stamp } as Parameters<typeof FollowEditProvider>[0],
    createElement(SaveSignal, { key: "save" }),
    createElement(OpenFollowOrder, { ...props, key: "open", expectedUpdatedAt: stamp }),
  );
  await act(() => root.render(render("2026-09-27T08:00:00.000Z")));
  await act(() => button("选择整表").click());
  await act(() => host.querySelector<HTMLInputElement>('[aria-label="确认本次开单范围"]')!.click());
  await act(() => button("模拟保存成功").click());
  expect(button("将所选").disabled).toBe(true);
  expect(host.textContent).toContain("正在回查最新款式与数量");
  expect(host.querySelector<HTMLInputElement>('[aria-label="确认本次开单范围"]')!.disabled).toBe(true);
  await act(() => root.render(render("2026-09-27T08:00:01.000Z")));
  expect(host.querySelector<HTMLInputElement>('[aria-label="确认本次开单范围"]')!.disabled).toBe(false);
  expect(host.querySelector<HTMLInputElement>('[aria-label="确认本次开单范围"]')!.checked).toBe(false);
});
