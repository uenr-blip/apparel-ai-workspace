/** @vitest-environment jsdom */
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { StyleConstructionFields } from "@/app/(app)/styles/style-construction-fields";
it("同一编辑器可从库替换，带规格和图，清空旧单耗颜色及旧上传", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); const host = document.createElement("div"), root = createRoot(host); document.body.append(host);
  try {
    await act(() => root.render(createElement(StyleConstructionFields, { initial: [{ key: "fabric", group: "fabric", name: "旧布", materialId: "old", fields: { consumption: "2", color: "红", position: "大身" }, imageId: "old-image" }], materials: [{ id: "new", code: "MAT-NEW", name: "新布", kind: "fabric", unit: "m", composition: "麻", gsm: "200", widthCm: "150", specSummary: "平纹", hasImage: true }] })));
    const oldInput = host.querySelector('input[type=file]');
    const select = host.querySelector<HTMLSelectElement>('[aria-label="替换旧布"]')!;
    await act(() => { select.value = "new"; select.dispatchEvent(new Event("change", { bubbles: true })); });
    const rows = JSON.parse(host.querySelector<HTMLInputElement>('input[name="construction"]')!.value);
    expect(rows[0]).toMatchObject({ name: "新布", materialId: "new", useMaterialImage: true, fields: { position: "大身", composition: "麻", specification: "平纹" } });
    expect(rows[0].fields.consumption).toBeUndefined(); expect(rows[0].fields.color).toBeUndefined(); expect(rows[0].imageId).toBeUndefined();
    expect(host.querySelector('input[type=file]')).not.toBe(oldInput); expect(host.querySelector('img')?.getAttribute('src')).toBe('/api/materials/new/image');
  } finally { await act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); }
});
