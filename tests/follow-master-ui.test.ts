/** @vitest-environment jsdom */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { BulkMasterBoard } from "@/app/(app)/orders/bulk-master-board";
import type { FollowStyleLine } from "@/server/services/order-merch";
import { shouldOpenImageZoom } from "@/lib/image-zoom";

let root: Root, host: HTMLDivElement;
const nativeShowModal = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "showModal");
const nativeClose = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "close");
const line = {
  key: "s:1", href: "/orders/follow/s?row=0", seasonCode: "SS27", factoryName: "达成",
  numericCode: "186700", styleCode: "ST-1", styleName: "Sweatshirt", po: "PO100519",
  purchaseDate: "2026-09-09", shipDate: "2026-10-31", inboundDate: "", productionOrderNo: "",
  productionHref: "", productionProgress: "", shipmentDates: [], materialSummary: "", composition: "棉",
  gsm: "", shellWidth: "", shellConsumption: "", orderNo: "", imageSrc: "", styleHref: "/styles/s1",
  otherTrim: "", progress: "待回色卡", button: "", zipper: "", hook: "", sampleColors: "", sheetTitle: "SS27",
  colors: [{ guestColor: "White", factoryColorName: "白色", qtyText: "150", metalBadge: "银色",
    colorTrims: { careSizeLabel: "第一行\n第二行\n第三行\n第四行完整说明" } }],
} as FollowStyleLine;
const lists = { sales: [], emptySheets: [], bulk: [{ factoryName: "达成", styles: [line] },
  { factoryName: "研色", styles: [{ ...line, key: "s:2", factoryName: "研色", po: "PO-OTHER" }] }] };

it("款式图片原地放大，品名、产品编号和 PO 打开本款基础信息", async () => {
  const network = vi.fn(); vi.stubGlobal("fetch", network);
  const withImage = { ...line, imageSrc: "/api/style-image/s1", productionHref: "/orders/p1" };
  await act(() => root.render(createElement(BulkMasterBoard, { lists: { ...lists, bulk: [{ factoryName: "达成", styles: [withImage] }] } })));
  const image = host.querySelector<HTMLImageElement>(".master-table img")!;
  expect(image.closest("a")).toBeNull();
  expect(shouldOpenImageZoom(image)).toBe(false);
  expect(host.querySelectorAll('a[href="/orders/follow/s?row=0#follow-product"]').length).toBe(3);
  await act(() => button("放大总表").click());
  await act(() => document.querySelector<HTMLButtonElement>('[aria-label="查看Sweatshirt款式图大图"]')!.click());
  const preview = document.querySelector<HTMLDialogElement>(".table-photo-dialog")!;
  expect(preview.open).toBe(true);
  await act(() => preview.querySelector<HTMLButtonElement>('[aria-label="放大图片"]')!.click());
  expect(preview.textContent).toContain("125%");
  await act(() => preview.dispatchEvent(new Event("cancel", { cancelable: true })));
  expect(document.querySelector(".table-photo-dialog")).toBeNull();
  expect(document.querySelector<HTMLDialogElement>(".master-focus-dialog")!.open).toBe(true);
  expect(network).not.toHaveBeenCalled();
});

it("销售样一款一行，沿用放大和筛选，打印保留图文、数量原文及费用", async () => {
  const sample = { ...line, imageSrc: "/api/style-image/s1", sampleColors: "白、黑", salesSampleQty: "24件，待分色", photoSample: "2", shellPrice: "10元", liningPrice: "5元", sampleElements: [{ id: "e1", label: "客户补充", text: "长说明末尾不能省略", images: ["/api/sheet-images/a.png"] }] };
  const source = { ...lists, sales: [sample, { ...sample, key: "b", po: "OTHER", factoryName: "研色" }] };
  await act(() => root.render(createElement(BulkMasterBoard, { lists: source, side: "sales", viewerKey: "u1", initial: { factory: "达成" } })));
  expect(host.textContent).toContain("销售样总表");
  expect(host.querySelectorAll(".master-table tbody tr")).toHaveLength(1);
  expect(host.textContent).toContain("24件，待分色");
  await act(() => button("放大总表").click());
  const printLink = [...document.querySelectorAll("a")].find(a => a.textContent === "打印 / PDF")!;
  expect(new URL(printLink.href).searchParams.get("sheet")).toBe("sales");
  expect(new URL(printLink.href).searchParams.get("factory")).toBe("达成");
  await act(() => document.querySelector("dialog")!.dispatchEvent(new Event("cancel", { cancelable: true })));
  await act(() => root.render(createElement(BulkMasterBoard, { lists: source, side: "sales", printMode: true, initial: { factory: "达成" } })));
  expect(host.querySelectorAll(".print-style-table")).toHaveLength(1);
  expect(host.textContent).toContain("长说明末尾不能省略");
  expect(host.textContent).toContain("面布 10元");
  expect(host.querySelectorAll("img")).toHaveLength(2);
  expect(host.querySelector("[rowspan]")).toBeNull();
});
function button(label: string) { return [...document.querySelectorAll("button")].find(node => node.textContent === label)!; }
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value: function (this: HTMLDialogElement) { this.open = true; } });
  Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value: function (this: HTMLDialogElement) { this.open = false; } });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => {
  await act(() => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals();
  for (const [name, descriptor] of [["showModal", nativeShowModal], ["close", nativeClose]] as const) {
    if (descriptor) Object.defineProperty(HTMLDialogElement.prototype, name, descriptor);
    else Reflect.deleteProperty(HTMLDialogElement.prototype, name);
  }
});

it("放大与 Esc 收起保留工厂筛选、显示列和原资料链接，不发起业务写入", async () => {
  const network = vi.fn(); vi.stubGlobal("fetch", network);
  await act(() => root.render(createElement(BulkMasterBoard, { lists })));
  const factory = host.querySelector<HTMLSelectElement>('[aria-label="总表工厂"]')!;
  await act(() => { factory.value = "达成"; factory.dispatchEvent(new Event("change", { bubbles: true })); });
  await act(() => button("放大总表").click());
  const dialog = document.querySelector("dialog")!;
  expect(dialog.open).toBe(true);
  expect(dialog.textContent).toContain("PO100519"); expect(dialog.textContent).not.toContain("PO-OTHER");
  expect(dialog.querySelector('a[href="/orders/follow/s?row=0#follow-color-trims"]')).not.toBeNull();
  expect(document.documentElement.style.overflow).toBe("hidden");
  const scale = dialog.querySelector<HTMLSelectElement>('[aria-label="表格缩放"]')!;
  await act(() => { scale.value = "120"; scale.dispatchEvent(new Event("change", { bubbles: true })); });
  expect(dialog.querySelector<HTMLElement>(".master-tables")!.style.zoom).toBe("1.2");
  await act(() => dialog.dispatchEvent(new Event("cancel", { bubbles: true, cancelable: true })));
  expect(document.querySelector("dialog")).toBeNull();
  expect(host.querySelector<HTMLSelectElement>('[aria-label="总表工厂"]')!.value).toBe("达成");
  expect(document.documentElement.style.overflow).toBe("");
  expect(document.activeElement).toBe(button("放大总表"));
  expect(network).not.toHaveBeenCalled();
});

it("紧凑视图可展开长说明，打印入口仍保留筛选并输出全文", async () => {
  await act(() => root.render(createElement(BulkMasterBoard, { lists, initial: { factory: "达成" } })));
  expect(host.querySelector(".master-compact")).not.toBeNull();
  await act(() => host.querySelector<HTMLInputElement>('[aria-label="展开长说明"]')!.click());
  expect(host.querySelector(".master-full-text")).not.toBeNull();
  expect(host.textContent).toContain("第四行完整说明");
  const print = [...host.querySelectorAll("a")].find(node => node.textContent === "打印 / PDF")!;
  expect(new URL(print.href).searchParams.get("factory")).toBe("达成");
  await act(() => root.render(createElement(BulkMasterBoard, { lists, printMode: true, initial: { factory: "达成" } })));
  expect(host.querySelector(".follow-print-root.master-full-text")).not.toBeNull();
  expect(host.textContent).toContain("第四行完整说明");
  expect(host.textContent).not.toContain("放大总表");
  expect(host.querySelector(".print-style-table")).not.toBeNull();
  expect(host.querySelector("[rowspan]")).toBeNull();
  expect(host.querySelector<HTMLElement>(".follow-print-root")!.dataset.paper).toBe("a4");
  const paper = host.querySelector<HTMLSelectElement>('[aria-label="打印纸张"]')!;
  await act(() => { paper.value = "a3"; paper.dispatchEvent(new Event("change", { bubbles: true })); });
  expect(host.querySelector<HTMLElement>(".follow-print-root")!.dataset.paper).toBe("a3");
});
