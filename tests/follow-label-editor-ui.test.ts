/** @vitest-environment jsdom */
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { BulkLabelEditor } from "@/app/(app)/orders/bulk-label-editor";
import { SampleElementsEditor } from "@/app/(app)/orders/sample-elements-editor";
import { emptyBulk, SAME_AS_CARE, type SampleElement } from "@/server/domain/merch-sheet";
let root: Root, host: HTMLDivElement;
beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(() => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function input(label: string, value: string) {
  const el = host.querySelector<HTMLInputElement>(`[aria-label="${label}"]`)!;
  await act(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, value); el.dispatchEvent(new Event("input", { bubbles: true })); });
}
async function select(label: string, value: string) {
  const el = host.querySelector<HTMLSelectElement>(`[aria-label="${label}"]`)!;
  await act(() => { el.value = value; el.dispatchEvent(new Event("change", { bubbles: true })); });
}
it("只出现一个共用主唛和一个特殊工艺列，黑白及自定义颜色能选用，同洗唛即时显示变化", async () => {
  function Harness() { const [bulk, setBulk] = useState({ ...emptyBulk(), colors: ["红色", "蓝色"].map(guestColor => ({ guestColor, factoryColorName: "", qtyText: "12", metalBadge: "" })) }); return createElement(BulkLabelEditor, { bulk, disabled: false, onMainLabel: mainLabel => setBulk({ ...bulk, mainLabel }), onMainImages: () => {}, onUploadChange: () => {}, onColor: (i, patch) => setBulk({ ...bulk, colors: bulk.colors.map((c, n) => n === i ? { ...c, ...patch } : c) }) }); }
  await act(() => root.render(createElement(Harness)));
  expect(host.querySelectorAll('[aria-label="主唛 · 本款共用"]')).toHaveLength(1);
  expect([...host.querySelectorAll("th")].map(t => t.textContent)).toEqual(["客人颜色", "洗唛", "尺码唛", "说明唛", "备扣空白唛", "吊牌", "特殊工艺", "每色其他辅料"]);
  await select("红色的洗唛颜色", "黑色"); await select("红色的说明唛颜色", SAME_AS_CARE);
  expect(host.textContent).toContain("同洗唛（黑色）");
  const care = host.querySelector('[aria-label="红色的洗唛颜色"]')!.parentElement!;
  await act(() => care.querySelector<HTMLButtonElement>("button")!.click());
  await input("红色的洗唛颜色新增", "灰色");
  await act(() => [...care.querySelectorAll("button")].find(b => b.textContent === "添加并选用")!.click());
  expect(host.textContent).toContain("同洗唛（灰色）");
  expect(host.querySelector<HTMLSelectElement>('[aria-label="红色的尺码唛颜色"]')!.value).toBe("");
  expect([...host.querySelectorAll('[aria-label="蓝色的尺码唛颜色"] option')].map(n => n.textContent)).toContain("灰色");
});
it("销售样能新增并编辑元素名称、文字和配图，移除有确认", async () => {
  const network = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ imageSrc: "/api/sheet-images/new-element-photo" }) }); vi.stubGlobal("fetch", network); vi.spyOn(window, "confirm").mockReturnValue(true);
  let latest: SampleElement[] = [];
  function Harness() { const [elements, setElements] = useState<SampleElement[]>([]); latest = elements; return createElement(SampleElementsEditor, { elements, limit: 24, disabled: false, onChange: setElements }); }
  await act(() => root.render(createElement(Harness)));
  await act(() => [...host.querySelectorAll("button")].find(b => b.textContent === "＋ 添加元素")!.click());
  await input("元素 1 名称", "包装袋"); await input("包装袋", "再生纸");
  const file = host.querySelector<HTMLInputElement>('input[type="file"]')!;
  Object.defineProperty(file, "files", { configurable: true, value: [new File(["image"], "bag.png", { type: "image/png" })] });
  await act(async () => { file.dispatchEvent(new Event("change", { bubbles: true })); });
  expect(latest[0]).toMatchObject({ label: "包装袋", text: "再生纸", images: ["/api/sheet-images/new-element-photo"] });
  await act(() => [...host.querySelectorAll("button")].find(b => b.textContent === "移除")!.click());
  expect(window.confirm).toHaveBeenCalled(); expect(latest).toEqual([]);
});
