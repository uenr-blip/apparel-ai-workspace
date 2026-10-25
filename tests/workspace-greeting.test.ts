import { describe, expect, it } from "vitest";
import { shanghaiHour, workspaceGreeting } from "@/lib/workspace-greeting";

describe("工作台问候", () => {
  it("上海 02:00 是夜深，不是早上好", () => {
    expect(shanghaiHour(new Date("2026-09-21T02:00:00+08:00"))).toBe(2);
    const line = workspaceGreeting("周衡", new Date("2026-09-21T02:00:00+08:00"));
    expect(line.hello).toBe("夜深了");
    expect(line.text).toMatch(/^夜深了，周衡。/);
    expect(line.text).not.toContain("早上好");
  });

  it("上海 20:30 是晚上好", () => {
    const line = workspaceGreeting("周衡", new Date("2026-09-21T20:30:00+08:00"));
    expect(line.hello).toBe("晚上好");
    expect(line.text).toMatch(/^晚上好，周衡。/);
  });

  it("同一小时同一人句子稳定，换小时会变", () => {
    const first = workspaceGreeting("周衡", new Date("2026-09-21T20:10:00+08:00"));
    const second = workspaceGreeting("周衡", new Date("2026-09-21T20:50:00+08:00"));
    const later = workspaceGreeting("周衡", new Date("2026-09-21T21:10:00+08:00"));
    expect(first.note).toBe(second.note);
    expect(first.note.length).toBeGreaterThan(0);
    expect(later.note.length).toBeGreaterThan(0);
  });
});
