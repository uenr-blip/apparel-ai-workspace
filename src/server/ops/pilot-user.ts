import { hash } from "bcryptjs";
import { randomUUID } from "node:crypto";
import { hostname, userInfo } from "node:os";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getLoginPolicy, normalizeLoginEmail, validatePilotPassword } from "@/lib/login-policy";

const Input = z.object({
  organizationId: z.string().min(1),
  email: z.string().transform(normalizeLoginEmail).pipe(z.email()),
  name: z.string().trim().min(1).max(80),
  role: z.enum(["salesperson", "manager", "factory"]),
  factoryId: z.string().min(1).optional(),
});

// Administrative CLI only: no HTTP route or agent tool exposes this function.
// Record the actual operating-system account instead of claiming a human actor.
export async function createPilotUser(input: z.input<typeof Input>, password: string) {
  const value = Input.parse(input);
  const policy = getLoginPolicy();
  if (policy.mode !== "pilot" || !policy.emails.includes(value.email)) throw new Error("请先将该账号加入试用名单");
  validatePilotPassword(password);
  if ((value.role === "factory") !== Boolean(value.factoryId)) throw new Error("工厂账号必须绑定工厂，其他账号不得绑定工厂");
  const passwordHash = await hash(password, 12);
  return prisma.$transaction(async tx => {
    const org = await tx.organization.findUnique({ where: { id: value.organizationId } });
    if (!org) throw new Error("组织不存在，请先核对试用数据所属组织");
    if (value.factoryId && !await tx.party.findFirst({ where: { id: value.factoryId, organizationId: value.organizationId, kind: "factory" } })) {
      throw new Error("工厂不属于该组织或不是工厂记录");
    }
    if (await tx.user.findUnique({ where: { email: value.email } })) throw new Error("账号已存在，本命令不会覆盖账号或重置口令");
    const user = await tx.user.create({
      data: { ...value, id: randomUUID(), passwordHash },
      select: { id: true, organizationId: true, email: true, name: true, role: true, factoryId: true, active: true },
    });
    await tx.auditEvent.create({ data: {
      id: randomUUID(), organizationId: user.organizationId, actorType: "system", actorUserId: null,
      action: "auth.pilot_user_created", entityType: "User", entityId: user.id,
      summary: "服务器管理员创建独立试用账号",
      payloadJson: JSON.stringify({ before: null, after: user, basis: "server_admin_cli_and_allowlist", operator: { account: userInfo().username, host: hostname() } }),
    } });
    return user;
  });
}
