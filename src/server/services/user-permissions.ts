import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { createId } from "@/lib/hash";
import { writeAudit } from "@/server/services/intake";
import { TRADE_PERMISSIONS } from "@/server/services/trade-contract";

import { MATERIAL_PERMISSIONS } from "./material-contract";

import { NEXT_FINANCE_PERMISSIONS } from "./ledger-contract";
export const DELEGABLE_PERMISSIONS = [
  ...NEXT_FINANCE_PERMISSIONS,
  ...MATERIAL_PERMISSIONS,
  ...TRADE_PERMISSIONS,
  { action: "inventory_transfer", label: "调拨材料", description: "确认材料移到另一工厂，保留来源批次" },
  { action: "inventory_consume", label: "登记领用", description: "登记实际耗用并减少工厂在手数量" },
  { action: "generate_factory_recon", label: "财务查阅与加工对账", description: "查阅财务概览与材料凭证，生成和更新加工草稿；不含付款" },
] as const;
export type DelegableAction = (typeof DELEGABLE_PERMISSIONS)[number]["action"];
type Actor = { organizationId: string; userId: string; role: string; factoryId?: string | null };
type PermissionDb = Pick<Prisma.TransactionClient, "user" | "organizationPolicy">;

export function permissionKey(userId: string, action: string) {
  return `user-action:${encodeURIComponent(userId)}:${action}`;
}
function isAction(action: string): action is DelegableAction {
  return DELEGABLE_PERMISSIONS.some(item => item.action === action);
}
function allowedForRole(role: string, action: string) {
  return role === "salesperson" || (role === "factory" && action === "inventory_consume");
}
export async function canUserAction(actor: Actor, action: DelegableAction, client: PermissionDb = prisma) {
  if (!isAction(action)) return false;
  if (actor.role === "manager") return true;
  if (!allowedForRole(actor.role, action)) return false;
  const user = await client.user.findFirst({ where: { id: actor.userId, organizationId: actor.organizationId, active: true } });
  if (!user || user.role !== actor.role || (user.role === "factory" && user.factoryId !== actor.factoryId)) return false;
  const policy = await client.organizationPolicy.findUnique({
    where: { organizationId_key: { organizationId: actor.organizationId, key: permissionKey(user.id, action) } },
  });
  return policy?.enabled === true;
}

async function requireManager(organizationId: string, userId: string, client: Pick<Prisma.TransactionClient, "user"> = prisma) {
  const manager = await client.user.findFirst({ where: { id: userId, organizationId, role: "manager", active: true } });
  if (!manager) throw new Error("只有当前组织经理可以下发或收回权限");
}

export async function setUserPermission(input: { organizationId: string; managerId: string; targetUserId: string; action: string; enabled: boolean }) {
  if (!isAction(input.action)) throw new Error("这项权限尚未开放下发");
  return prisma.$transaction(async tx => {
    await requireManager(input.organizationId, input.managerId, tx);
    const user = await tx.user.findFirst({ where: { id: input.targetUserId, organizationId: input.organizationId } });
    if (!user || user.role === "manager") throw new Error("员工不存在或无需下发经理固有权限");
    if (input.enabled && (!user.active || !allowedForRole(user.role, input.action))) throw new Error("不能向该员工下发此权限，工厂数据范围保持隔离");
    const key = permissionKey(user.id, input.action);
    const current = await tx.organizationPolicy.findUnique({ where: { organizationId_key: { organizationId: input.organizationId, key } } });
    if ((current?.enabled ?? false) === input.enabled) return { changed: false, enabled: input.enabled };
    const policy = await tx.organizationPolicy.upsert({
      where: { organizationId_key: { organizationId: input.organizationId, key } },
      create: { id: createId(), organizationId: input.organizationId, key, enabled: input.enabled, note: "经理下发的员工动作权限", valueJson: JSON.stringify({ userId: user.id, action: input.action, changedBy: input.managerId }) },
      update: { enabled: input.enabled, valueJson: JSON.stringify({ userId: user.id, action: input.action, changedBy: input.managerId }) },
    });
    await writeAudit({ organizationId: input.organizationId, actorUserId: input.managerId, action: input.enabled ? "permission.granted" : "permission.revoked", entityType: "UserPermission", entityId: policy.id,
      summary: `${input.enabled ? "授权" : "收回"} ${user.name} 的${DELEGABLE_PERMISSIONS.find(item => item.action === input.action)!.label}`,
      payloadJson: JSON.stringify({ targetUserId: user.id, permission: input.action, before: current?.enabled ?? false, after: input.enabled }),
    }, tx);
    return { changed: true, enabled: input.enabled };
  });
}

export async function listPermissionAssignments(organizationId: string, managerId: string, query = "") {
  await requireManager(organizationId, managerId);
  const q = query.trim().slice(0, 80);
  const where = { organizationId, role: { not: "manager" }, ...(q ? { OR: [{ name: { contains: q } }, { email: { contains: q } }] } : {}) };
  const [total, users] = await prisma.$transaction([
    prisma.user.count({ where }),
    prisma.user.findMany({ where, orderBy: [{ name: "asc" }, { id: "asc" }], take: 50, select: { id: true, name: true, email: true, role: true, active: true, factoryId: true } }),
  ]);
  const keys = users.flatMap(user => DELEGABLE_PERMISSIONS.map(item => permissionKey(user.id, item.action)));
  const grants = await prisma.organizationPolicy.findMany({ where: { organizationId, key: { in: keys }, enabled: true }, select: { key: true } });
  const enabled = new Set(grants.map(row => row.key));
  return { total, users: users.map(user => ({ ...user, actions: DELEGABLE_PERMISSIONS.map(item => ({ ...item, enabled: enabled.has(permissionKey(user.id, item.action)), canGrant: user.active && allowedForRole(user.role, item.action) })) })) };
}
