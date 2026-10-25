import { describe, expect, it } from "vitest";
import { serverSafeTheme, themeFromDocument } from "@/lib/theme";

describe("主题首屏", () => {
  it("服务端和首次客户端渲染固定纸色，避免读 localStorage 造成水合不一致", () => {
    expect(serverSafeTheme()).toBe("atelier");
    expect(themeFromDocument(null)).toBe("atelier");
    expect(themeFromDocument({ documentElement: { getAttribute: () => null } })).toBe("atelier");
  });

  it("挂载后再按文档属性读墨黑", () => {
    expect(themeFromDocument({ documentElement: { getAttribute: (name) => (name === "data-theme" ? "noir" : null) } })).toBe(
      "noir",
    );
  });
});
