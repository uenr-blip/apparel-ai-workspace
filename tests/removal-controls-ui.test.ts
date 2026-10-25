/** @vitest-environment jsdom */
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { FileWell } from "@/components/file-well";
import { SheetPicture } from "@/app/(app)/orders/sheet-picture";
import { MerchSheetForm } from "@/app/(app)/orders/merch-sheet-form";
import { emptyMerchStyle } from "@/server/domain/merch-sheet";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
let root: Root, host: HTMLDivElement;
beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(() => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("误选文档可移除，清空文件输入并释放缩略预览，可重新选择", async () => {
  const oldCreate = URL.createObjectURL, oldRevoke = URL.revokeObjectURL;
  const revoke = vi.fn(); URL.createObjectURL = vi.fn(() => "blob:file"); URL.revokeObjectURL = revoke;
  try {
    await act(() => root.render(createElement("form", {}, createElement(FileWell, { label: "客户文件", hint: "文档" }))));
    const input = host.querySelector<HTMLInputElement>('input[type="file"]')!;
    const file = new File(["pdf"], "本次误选.pdf", { type: "application/pdf" });
    Object.defineProperty(input, "files", { configurable: true, value: [file] });
    await act(() => input.dispatchEvent(new Event("change", { bubbles: true })));
    expect(host.querySelector(".attachment-thumbnail-document")).not.toBeNull();
    await act(() => host.querySelector<HTMLButtonElement>('[aria-label="移除已选文件：本次误选.pdf"]')!.click());
    expect(host.querySelector(".attachment-thumbnail-document")).toBeNull();
    expect(input.value).toBe(""); expect(revoke).toHaveBeenCalledWith("blob:file");
    await act(() => input.dispatchEvent(new Event("change", { bubbles: true })));
    expect(host.querySelector(".attachment-thumbnail-document")).not.toBeNull();
  } finally { await act(() => root.render(null)); URL.createObjectURL = oldCreate; URL.revokeObjectURL = oldRevoke; }
});

it("版单主图可从当前草稿移除，只读没有移除按钮，不删除文件或调用服务", async () => {
  const network = vi.fn(); vi.stubGlobal("fetch", network);
  function Harness() { const [src,setSrc] = useState("/api/sheet-images/example-image"); return createElement(SheetPicture, { label: "本款款式图", imageSrc: src, disabled: false, onChange: setSrc }); }
  await act(() => root.render(createElement(Harness)));
  expect(host.querySelector('[aria-label="查看本款款式图大图"]')).not.toBeNull();
  await act(() => host.querySelector<HTMLButtonElement>('[aria-label="移除本款款式图"]')!.click());
  expect(host.querySelector("img")).toBeNull(); expect(network).not.toHaveBeenCalled();
  await act(() => root.render(createElement(SheetPicture, { label: "本款款式图", imageSrc: "/api/sheet-images/example-image", disabled: true, onChange: vi.fn() })));
  expect(host.querySelector('[aria-label="移除本款款式图"]')).toBeNull();
});

it("跟单新增款和新增颜色可以取消，已保存的颜色保留，临时操作不写入业务", async () => {
  const network = vi.fn(); vi.stubGlobal("fetch", network);
  const row = { ...emptyMerchStyle(), rowId: "saved-row", styleCode: "ST-01", styleName: "原款" };
  row.bulk.colors = [{ guestColor: "红色", factoryColorName: "红", qtyText: "100", metalBadge: "" }];
  await act(() => root.render(createElement(MerchSheetForm, { orderId: "sheet", kind: "bulk", styles: [row], expectedUpdatedAt: "2026-09-27T00:00:00Z", seasonCode: "SS27", styleChoices: [], purchases: [], canEdit: true })));
  const button=(text:string)=>[...host.querySelectorAll("button")].find(b=>b.textContent?.trim()===text)!;
  await act(() => button("加一个颜色").click());
  expect(host.querySelector('[aria-label="2 行客人颜色"]')).not.toBeNull();
  await act(() => host.querySelector<HTMLButtonElement>('[aria-label="取消新增颜色 2"]')!.click());
  expect(host.querySelector('[aria-label="2 行客人颜色"]')).toBeNull();
  expect(host.querySelector('[aria-label="取消新增颜色 1"]')).toBeNull();
  expect(host.querySelector<HTMLInputElement>('[aria-label="1 行客人颜色"]')?.value).toBe("红色");
  const addStyle=button("加一个还没建档的款");
  await act(() => addStyle.click());
  await act(() => host.querySelector<HTMLButtonElement>('[aria-label="取消新增款 2"]')!.click());
  expect(host.querySelector('[aria-label="取消新增款 1"]')).toBeNull();
  expect(network).not.toHaveBeenCalled();
});
