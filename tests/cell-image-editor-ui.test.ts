/** @vitest-environment jsdom */
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CellImageEditor } from "@/app/(app)/orders/cell-image-editor";

let root: Root, host: HTMLDivElement;
beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(() => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function choose(file: File) {
  const input = host.querySelector<HTMLInputElement>('input[type="file"]')!;
  Object.defineProperty(input, "files", { configurable: true, value: [file] });
  await act(() => input.dispatchEvent(new Event("change", { bubbles: true })));
}
it("上传期间报告忙状态，失败可重试，成功显示缩略图并可移除，不影响文字", async () => {
  let resolve: (value: unknown) => void = () => {};
  const network = vi.fn().mockImplementation(() => new Promise(r => { resolve = r; })); vi.stubGlobal("fetch", network);
  const changes = vi.fn(); let latest: string[] = [];
  function Harness() { const [images, setImages] = useState<string[]>([]); latest = images; return createElement(CellImageEditor, { label: "红色的洗唛", images, disabled: false, onChange: setImages, onUploadChange: changes }); }
  await act(() => root.render(createElement(Harness)));
  await choose(new File(["image"], "care.png", { type: "image/png" }));
  expect(changes).toHaveBeenLastCalledWith(1); expect(host.querySelector<HTMLButtonElement>("button")!.disabled).toBe(true);
  await act(async () => resolve({ ok: false, json: async () => ({ error: "请重试" }) }));
  expect(changes).toHaveBeenLastCalledWith(-1); expect(host.textContent).toContain("请重试"); expect(latest).toEqual([]);
  await choose(new File(["image"], "care.png", { type: "image/png" }));
  await act(async () => resolve({ ok: true, json: async () => ({ imageSrc: "/api/sheet-images/new-care-photo" }) }));
  expect(latest).toEqual(["/api/sheet-images/new-care-photo"]); expect(host.querySelector("img")!.alt).toBe("红色的洗唛图片 1");
  await act(() => host.querySelector<HTMLButtonElement>('[aria-label="移除红色的洗唛图片 1"]')!.click());
  expect(latest).toEqual([]);
});
it("非图片不发送，六张时停止增加，只读不能上传或删除", async () => {
  const network = vi.fn(); vi.stubGlobal("fetch", network);
  const props = { label: "主唛", images: [] as string[], disabled: false, onChange: vi.fn(), onUploadChange: vi.fn() };
  await act(() => root.render(createElement(CellImageEditor, props)));
  await choose(new File(["plain"], "a.txt", { type: "text/plain" }));
  expect(network).not.toHaveBeenCalled(); expect(host.textContent).toContain("JPG");
  const images = Array.from({ length: 6 }, (_, i) => `/api/sheet-images/picture-${i}`);
  await act(() => root.render(createElement(CellImageEditor, { ...props, images })));
  expect(host.querySelector<HTMLButtonElement>('[aria-label="主唛增加图片"]')!.disabled).toBe(true);
  await act(() => root.render(createElement(CellImageEditor, { ...props, images, disabled: true })));
  expect(host.querySelectorAll("button")).toHaveLength(0); expect(host.querySelectorAll("img")).toHaveLength(6);
});
