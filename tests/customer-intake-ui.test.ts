/** @vitest-environment jsdom */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { IntakeReviewForm } from "@/app/(app)/inbox/[sourceId]/intake-review-form";
import { emptyIntakeDraft } from "@/lib/customer-intake";
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
let host: HTMLDivElement, root: Root;
beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
function button(text: string) { return [...host.querySelectorAll("button")].find(b => b.textContent === text)!; }
it("核对表格必须先保存再确认，变更客户会撤销确认，部分款号可筛选已有款", async () => {
  const draft = emptyIntakeDraft(); Object.assign(draft, { title: "PO草稿", customerId: "c1", factoryId: "f1", po: "PO1" }); Object.assign(draft.items[0], { styleId: "s1", styleName: "毛衣", colors: [{ name: "白色", quantity: "100" }] });
  const request = vi.fn().mockResolvedValue(new Response(JSON.stringify({ proposalId: "p1", revision: "r1", jobId: "j1" }), { status: 200 })); vi.stubGlobal("fetch", request);
  await act(() => root.render(createElement(IntakeReviewForm, { sourceId: "source", initial: draft, jobId: "j1", proposalId: null, revision: null, catalog: { customers: [{ id: "c1", code: "C1", name: "客户A" }, { id: "c2", code: "C2", name: "客户B" }], factories: [{ id: "f1", name: "研色", code: "F1" }], styles: [{ id: "s1", name: "毛衣", code: "DEV-021" }] }, modelReady: false, calledLiveModel: false, error: null, warnings: [] })));
  expect(button("确认，建成大货跟单").disabled).toBe(true);
  await act(() => button("保存核对草稿").click()); expect(request).toHaveBeenCalledOnce(); expect(JSON.parse(request.mock.calls[0][1].body).operation).toBe("save");
  const checkbox = host.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
  await act(() => checkbox.click()); expect(button("确认，建成大货跟单").disabled).toBe(false);
  const customer = host.querySelector<HTMLSelectElement>('select[aria-label="客户"]')!;
  await act(() => { customer.value = "c2"; customer.dispatchEvent(new Event("change", { bubbles: true })); });
  expect(checkbox.checked).toBe(false); expect(button("确认，建成大货跟单").disabled).toBe(true); expect(request).toHaveBeenCalledOnce();
  expect(host.textContent).toContain("DEV-021"); expect(host.querySelector('input[aria-label="第 1 款关联款式搜索"]')).not.toBeNull();
});
