import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hash } from "bcryptjs";
import { IDS } from "@/lib/constants";
import { prisma } from "@/lib/db";
import { createSession, getSession, loginWithPassword } from "@/lib/auth";
import { getLoginPolicy, getLoginPresentation } from "@/lib/login-policy";
import { createPilotUser } from "@/server/ops/pilot-user";
import { POST } from "@/app/api/auth/login/route";
import { resetDatabase } from "./helpers";

const state = vi.hoisted(() => ({ jar: new Map<string, string>(), options: {} as Record<string, unknown> }));
vi.mock("next/headers", () => ({ cookies: async () => ({
  get: (name: string) => state.jar.has(name) ? { value: state.jar.get(name) } : undefined,
  set: (name: string, value: string, options: Record<string, unknown>) => { state.jar.set(name, value); state.options = options; },
  delete: (name: string) => state.jar.delete(name),
}) }));

const email = "staff@pilot.example";
const password = "Pilot-test-passphrase-5841";
const input = { organizationId: IDS.orgDemo, email, name: "试用跟单员", role: "salesperson" as const };

function enablePilot() {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("PILOT_LOGIN_ENABLED", "true");
  vi.stubEnv("DEMO_LOGIN_ENABLED", "false");
  vi.stubEnv("SESSION_SECRET", "pilot-test-only-32-character-unique-key-1234");
  vi.stubEnv("APP_URL", "https://pilot.example:8443");
  vi.stubEnv("PILOT_LOGIN_EMAILS", `${email},factory@pilot.example`);
}

describe("独立试用登录与账号隔离", () => {
  beforeEach(async () => { state.jar.clear(); state.options = {}; await resetDatabase(); enablePilot(); });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

  it("创建后可在正式启动模式登录，按当前用户回查会话并记录审计", async () => {
    const user = await createPilotUser(input, password);
    const created = await prisma.auditEvent.findFirstOrThrow({ where: { entityId: user.id, action: "auth.pilot_user_created" } });
    expect(created.actorType).toBe("system");
    expect(created.actorUserId).toBeNull();
    expect(JSON.parse(created.payloadJson!).operator.account).toBeTruthy();
    expect(created.payloadJson).not.toContain(password);
    expect(created.payloadJson).not.toContain("passwordHash");
    expect(await loginWithPassword(" STAFF@pilot.example ", password)).toMatchObject({ id: user.id, role: "salesperson" });
    expect(await getSession()).toMatchObject({ id: user.id, organizationId: IDS.orgDemo });
    expect(await getSession()).not.toHaveProperty("passwordHash");
    expect(state.options).toMatchObject({ secure: true, httpOnly: true, sameSite: "lax", maxAge: 604800 });
    expect(await prisma.auditEvent.count({ where: { actorUserId: user.id, action: "auth.pilot_login" } })).toBe(1);
  });

  it("生产模式默认仍关闭，试用与演示不能同时打开", async () => {
    vi.stubEnv("PILOT_LOGIN_ENABLED", "false");
    vi.stubEnv("DEMO_LOGIN_ENABLED", "true");
    await expect(loginWithPassword("salesperson@demo.local", "DemoPass!2026")).rejects.toThrow(/生产环境/);
    vi.stubEnv("PILOT_LOGIN_ENABLED", "true");
    expect(() => getLoginPolicy()).toThrow(/不能同时/);
    expect(getLoginPresentation()).toBe("disabled");
    expect(state.jar.size).toBe(0);
  });

  it("拒绝 HTTP、默认密钥、空名单和演示名单", () => {
    vi.stubEnv("APP_URL", "http://pilot.example");
    expect(() => getLoginPolicy()).toThrow(/HTTPS/);
    vi.stubEnv("APP_URL", "https://pilot.example");
    vi.stubEnv("SESSION_SECRET", "change-me-to-a-long-random-string-for-local-dev");
    expect(() => getLoginPolicy()).toThrow(/会话密钥/);
    vi.stubEnv("SESSION_SECRET", "pilot-test-only-32-character-unique-key-1234");
    for (const value of ["", "*@pilot.example", "salesperson@demo.local"]) {
      vi.stubEnv("PILOT_LOGIN_EMAILS", value);
      expect(() => getLoginPolicy()).toThrow(/试用账号名单/);
    }
  });

  it("公共演示账号不能登录，未列入名单的已有账号也不能登录", async () => {
    await createPilotUser(input, password);
    await expect(loginWithPassword("salesperson@demo.local", "DemoPass!2026")).rejects.toThrow(/账号或密码/);
    vi.stubEnv("PILOT_LOGIN_EMAILS", "factory@pilot.example");
    await expect(loginWithPassword(email, password)).rejects.toThrow(/账号或密码/);
    expect(state.jar.size).toBe(0);
  });

  it("历史账号即使加入名单也不能沿用公共演示口令", async () => {
    await prisma.user.update({ where: { id: IDS.userSales }, data: { email } });
    await expect(loginWithPassword(email, "DemoPass!2026")).rejects.toThrow(/账号或密码/);
    expect(state.jar.size).toBe(0);
  });

  it("五次失败后拒绝再试，失败留痕不冒充已认证用户", async () => {
    const user = await createPilotUser(input, password);
    for (let i = 0; i < 5; i++) await expect(loginWithPassword(email, "wrong-password-999")).rejects.toThrow(/账号或密码/);
    await expect(loginWithPassword(email, password)).rejects.toThrow(/尝试次数过多/);
    const failures = await prisma.auditEvent.findMany({ where: { entityId: user.id, action: "auth.pilot_login_failed" } });
    expect(failures).toHaveLength(5);
    expect(failures.every(event => event.actorUserId === null && event.actorType === "anonymous")).toBe(true);
    expect(JSON.stringify(failures)).not.toContain("wrong-password-999");
    await prisma.auditEvent.updateMany({ where: { entityId: user.id, action: "auth.pilot_login_failed" }, data: { createdAt: new Date(Date.now() - 16 * 60_000) } });
    expect(await loginWithPassword(email, password)).toMatchObject({ id: user.id });
  });

  it("重启前已有的失败记录仍会限制登录", async () => {
    const user = await createPilotUser(input, password);
    await prisma.auditEvent.createMany({ data: Array.from({ length: 5 }, (_, i) => ({
      id: `previous-failure-${i}`, organizationId: user.organizationId, actorType: "anonymous",
      action: "auth.pilot_login_failed", entityType: "User", entityId: user.id, summary: "历史失败",
    })) });
    await expect(loginWithPassword(email, password)).rejects.toThrow(/尝试次数过多/);
  });

  it("口令更新、账号停用、移出试用名单都会使旧会话失效", async () => {
    const user = await createPilotUser(input, password);
    await loginWithPassword(email, password);
    await prisma.user.update({ where: { id: user.id }, data: { active: false } });
    expect(await getSession()).toBeNull();
    await prisma.user.update({ where: { id: user.id }, data: { active: true } });
    vi.stubEnv("PILOT_LOGIN_EMAILS", "factory@pilot.example");
    expect(await getSession()).toBeNull();
    vi.stubEnv("PILOT_LOGIN_EMAILS", email);
    await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await hash("new-secret-for-test-2298", 10) } });
    expect(await getSession()).toBeNull();
  });

  it("签发前重查口令，不能拿重置前的校验结果生成新会话", async () => {
    const user = await createPilotUser(input, password);
    const old = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await hash("another-test-secret-4567", 10) } });
    await expect(createSession(user, old.passwordHash)).rejects.toThrow(/重新登录/);
    expect(state.jar.size).toBe(0);
  });

  it("角色和工厂范围从当前账号读取，不信任旧令牌", async () => {
    const user = await createPilotUser({ ...input, email: "factory@pilot.example", role: "factory", factoryId: IDS.factoryYunshan }, password);
    await loginWithPassword(user.email, password);
    expect(await getSession()).toMatchObject({ role: "factory", factoryId: IDS.factoryYunshan });
    await prisma.user.update({ where: { id: user.id }, data: { role: "salesperson", factoryId: null } });
    expect(await getSession()).toMatchObject({ role: "salesperson", factoryId: null });
  });

  it("账号创建拒绝越组织工厂、弱口令、重复覆盖，失败不会产生新账号", async () => {
    await expect(createPilotUser(input, "DemoPass!2026")).rejects.toThrow(/口令/);
    await expect(createPilotUser(input, "短口令")).rejects.toThrow(/口令/);
    await expect(createPilotUser(input, "很长的中文口令".repeat(10))).rejects.toThrow(/口令/);
    await expect(createPilotUser({ ...input, role: "factory", factoryId: "missing-factory" }, password)).rejects.toThrow(/工厂/);
    await expect(createPilotUser({ ...input, organizationId: IDS.orgIso, role: "factory", factoryId: IDS.factoryYunshan }, password)).rejects.toThrow(/工厂/);
    expect(await prisma.user.count({ where: { email } })).toBe(0);
    const user = await createPilotUser(input, password);
    await expect(createPilotUser({ ...input, role: "manager" }, "changed-password-9000")).rejects.toThrow(/已存在/);
    expect(await prisma.user.findUnique({ where: { id: user.id } })).toMatchObject({ role: "salesperson" });
  });

  it("登录审计写入失败时清除已准备的会话", async () => {
    await createPilotUser(input, password);
    await prisma.$executeRawUnsafe("CREATE TRIGGER fail_pilot_audit BEFORE INSERT ON AuditEvent WHEN NEW.action = 'auth.pilot_login' BEGIN SELECT RAISE(ABORT, 'audit unavailable'); END;");
    try {
      await expect(loginWithPassword(email, password)).rejects.toThrow();
      expect(state.jar.size).toBe(0);
    } finally { await prisma.$executeRawUnsafe("DROP TRIGGER fail_pilot_audit"); }
  });

  it("新建账号与审计同事务，留痕失败不留下账号", async () => {
    await prisma.$executeRawUnsafe("CREATE TRIGGER fail_pilot_create_audit BEFORE INSERT ON AuditEvent WHEN NEW.action = 'auth.pilot_user_created' BEGIN SELECT RAISE(ABORT, 'audit unavailable'); END;");
    try {
      await expect(createPilotUser(input, password)).rejects.toThrow();
      expect(await prisma.user.count({ where: { email } })).toBe(0);
    } finally { await prisma.$executeRawUnsafe("DROP TRIGGER fail_pilot_create_audit"); }
  });

  it("并发登录不能绕过每账号的失败次数检查", async () => {
    await createPilotUser(input, password);
    const results = await Promise.allSettled([loginWithPassword(email, "wrong-password-999"), loginWithPassword(email, "wrong-password-999")]);
    expect(results.every(result => result.status === "rejected")).toBe(true);
    expect(results.some(result => result.status === "rejected" && /处理中/.test(String(result.reason)))).toBe(true);
    expect(await prisma.auditEvent.count({ where: { action: "auth.pilot_login_failed" } })).toBe(1);
  });

  it("登录 API 拒绝外站来源，合法来源登录成功，非法 JSON 可控失败", async () => {
    await createPilotUser(input, password);
    const request = (origin: string, body = JSON.stringify({ email, password })) => new Request("https://pilot.example:8443/api/auth/login", { method: "POST", headers: { origin, "content-type": "application/json" }, body });
    expect((await POST(request("https://other.example"))).status).toBe(403);
    expect((await POST(request("https://pilot.example:8443", "bad-json"))).status).toBe(400);
    expect((await POST(request("https://pilot.example:8443"))).status).toBe(200);
    expect(await getSession()).toMatchObject({ email });
  });
});
