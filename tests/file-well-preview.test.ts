/** @vitest-environment jsdom */
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { FileWell } from "@/components/file-well";
it("选择图片后即时缩略，文档显示类型卡，重选与表单重置释放预览且保留文件提交", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); const make = vi.fn().mockReturnValueOnce("blob:picture").mockReturnValueOnce("blob:document").mockReturnValueOnce("blob:untrusted"), revoke = vi.fn();
  const oldCreate = URL.createObjectURL, oldRevoke = URL.revokeObjectURL; URL.createObjectURL = make; URL.revokeObjectURL = revoke;
  const host = document.createElement("div"), root = createRoot(host); document.body.append(host); const onFile = vi.fn();
  try {
    await act(() => root.render(createElement("form", {}, createElement(FileWell, { label: "附件", hint: "图片或文档", onFile }))));
    const input = host.querySelector<HTMLInputElement>('input[type=file]')!;
    async function select(file: File) { Object.defineProperty(input, "files", { configurable: true, value: [file] }); await act(() => input.dispatchEvent(new Event("change", { bubbles: true }))); }
    const picture = new File(["png"], "面料.png", { type: "image/png" }); await select(picture);
    expect(onFile).toHaveBeenLastCalledWith(picture); expect(input.name).toBe("file"); expect(host.querySelector("img")?.getAttribute("src")).toBe("blob:picture"); expect(host.querySelector("img")?.closest("label")).toBeNull();
    await select(new File(["pdf"], "客户资料.pdf", { type: "application/pdf" }));
    expect(host.querySelector("img")).toBeNull(); expect(host.querySelector(".attachment-thumbnail-document")?.textContent).toContain("PDF"); expect(host.querySelector("a")?.href).toBe("blob:document"); expect(revoke).toHaveBeenCalledWith("blob:picture");
    await select(new File(["<html>untrusted</html>"], "误选文档.html", { type: "text/html" }));
    expect(host.querySelector("a")?.getAttribute("download")).toBe("误选文档.html");
    await act(() => host.querySelector("form")!.reset()); expect(host.querySelector(".attachment-thumbnail")).toBeNull(); expect(revoke).toHaveBeenCalledWith("blob:document");
  } finally { await act(() => root.unmount()); host.remove(); URL.createObjectURL = oldCreate; URL.revokeObjectURL = oldRevoke; vi.unstubAllGlobals(); }
});
