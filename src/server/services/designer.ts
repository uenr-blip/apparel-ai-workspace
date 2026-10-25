import { prisma } from "@/lib/db";
import { createId } from "@/lib/hash";
import { ROLES } from "@/lib/constants";
import { writeAudit } from "@/server/services/intake";

export class DesignerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DesignerError";
  }
}

function assertCanEdit(role: string) {
  if (role === ROLES.factory) throw new DesignerError("当前角色无权维护设计师名单");
}

export async function listDesigners(organizationId: string) {
  return prisma.designer.findMany({
    where: { organizationId },
    orderBy: { name: "asc" },
    include: { _count: { select: { styles: true } } },
  });
}

export async function createDesigner(input: {
  organizationId: string;
  userId: string;
  role: string;
  name: string;
}) {
  assertCanEdit(input.role);
  const name = input.name.trim();
  if (!name) throw new DesignerError("请填写设计师姓名");
  const exists = await prisma.designer.findFirst({
    where: { organizationId: input.organizationId, name },
  });
  if (exists) throw new DesignerError("这位设计师已经在名单里");
  const designer = await prisma.designer.create({
    data: { id: createId(), organizationId: input.organizationId, name },
  });
  await writeAudit({
    organizationId: input.organizationId,
    actorUserId: input.userId,
    action: "designer.created",
    entityType: "Designer",
    entityId: designer.id,
    summary: `名单增加设计师 ${name}，这是款式署名，不是登录账号`,
  });
  return designer;
}

export async function removeDesigner(input: {
  organizationId: string;
  userId: string;
  role: string;
  designerId: string;
}) {
  assertCanEdit(input.role);
  const designer = await prisma.designer.findFirst({
    where: { id: input.designerId, organizationId: input.organizationId },
    include: { _count: { select: { styles: true } } },
  });
  if (!designer) throw new DesignerError("设计师不存在或不属于当前组织");
  if (designer._count.styles > 0) throw new DesignerError("还有款式挂着这位设计师，先从款上撤下");
  await prisma.designer.delete({ where: { id: designer.id } });
  await writeAudit({
    organizationId: input.organizationId,
    actorUserId: input.userId,
    action: "designer.removed",
    entityType: "Designer",
    entityId: designer.id,
    summary: `名单移除设计师 ${designer.name}，未删除款式主档`,
  });
  return { removed: true, name: designer.name };
}

export async function assignStyleDesigner(input: {
  organizationId: string;
  userId: string;
  role: string;
  styleId: string;
  designerId: string | null;
}) {
  assertCanEdit(input.role);
  const style = await prisma.style.findFirst({
    where: { id: input.styleId, organizationId: input.organizationId },
  });
  if (!style) throw new DesignerError("款式不存在或不属于当前组织");
  let designerName = "未指定";
  if (input.designerId) {
    const designer = await prisma.designer.findFirst({
      where: { id: input.designerId, organizationId: input.organizationId },
    });
    if (!designer) throw new DesignerError("设计师不存在或不属于当前组织");
    designerName = designer.name;
  }
  await prisma.style.update({
    where: { id: style.id },
    data: { designerId: input.designerId },
  });
  await writeAudit({
    organizationId: input.organizationId,
    actorUserId: input.userId,
    action: input.designerId ? "style.designer.assigned" : "style.designer.cleared",
    entityType: "Style",
    entityId: style.id,
    summary: input.designerId
      ? `款号 ${style.code} 署名为 ${designerName}`
      : `款号 ${style.code} 已撤下设计师署名`,
  });
  return { styleId: style.id, designerId: input.designerId, designerName };
}
