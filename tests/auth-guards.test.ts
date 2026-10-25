import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IDS } from "@/lib/constants";
import { prisma } from "@/lib/db";
import { createSession, getSession, loginWithPassword, requireSession } from "@/lib/auth";
import { resetDatabase } from "./helpers";

const jar = vi.hoisted(() => new Map<string, string>());
vi.mock("next/headers", () => ({ cookies: async () => ({
  get: (name: string) => jar.has(name) ? { value: jar.get(name) } : undefined,
  set: (name: string, value: string) => jar.set(name, value),
  delete: (name: string) => jar.delete(name),
}) }));
const user = { id: IDS.userSales, organizationId: IDS.orgDemo, email: "salesperson@demo.local", name: "林清意", role: "salesperson", factoryId: null };
describe("会话撤销与演示登录边界", () => {
  beforeEach(async () => { jar.clear(); await resetDatabase(); });
  afterEach(() => { vi.unstubAllEnvs(); });
  it("未登录的业务页面跳回登录页，已登录时保留真实会话", async () => {
    await expect(requireSession()).rejects.toMatchObject({ digest: "NEXT_REDIRECT;replace;/login;307;" });
    await createSession(user);
    expect(await requireSession()).toMatchObject(user);
  });
  it("生产环境即使设置demo=true也拒绝演示登录", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DEMO_LOGIN_ENABLED", "true");
    await expect(loginWithPassword(user.email, "DemoPass!2026")).rejects.toThrow(/生产环境/);
    expect(jar.size).toBe(0);
  });
  it("停用用户后旧会话立即失效", async () => {
    await createSession(user);
    await prisma.user.update({ where: { id: user.id }, data: { active: false } });
    expect(await getSession()).toBeNull();
  });
  it("角色改变后不继续信任旧JWT里的权限", async () => {
    await createSession(user);
    await prisma.user.update({ where: { id: user.id }, data: { role: "factory", factoryId: IDS.factoryYunshan } });
    expect(await getSession()).toMatchObject({ role: "factory", factoryId: IDS.factoryYunshan });
  });
});
