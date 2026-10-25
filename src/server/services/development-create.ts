import { ACTION_TYPES } from "@/lib/constants";
import { prisma } from "@/lib/db";
import { createId } from "@/lib/hash";
import { canApproveAction } from "@/server/permissions";
import { ExecutionError } from "@/server/services/execution";
import { writeAudit } from "@/server/services/intake";
import { lockOrganizationForWrite } from "@/server/services/order-write";

export async function createDevelopmentProject(input: {
  organizationId: string;
  userId: string;
  role: string;
  name: string;
  styleId?: string | null;
  materialIds?: string[];
}) {
  if (!canApproveAction(input.role, ACTION_TYPES.createDevelopmentProject)) {
    throw new ExecutionError("无权新建开发款式");
  }
  const name = input.name.trim();
  if (!name) throw new ExecutionError("请填写项目名称");
  const styleId = input.styleId?.trim() || null;
  const materialIds = [...new Set((input.materialIds ?? []).map((id) => id.trim()).filter(Boolean))];

  const result = await prisma.$transaction(async (tx) => {
    await lockOrganizationForWrite(tx, input.organizationId);
    const actor = await tx.user.findFirst({ where: { id: input.userId, organizationId: input.organizationId, role: input.role, active: true } });
    if (!actor) throw new ExecutionError("当前账号已变化，请重新登录核对");
    if (styleId) {
      const style = await tx.style.findFirst({
        where: { id: styleId, organizationId: input.organizationId },
        select: { id: true },
      });
      if (!style) throw new ExecutionError("关联款式不存在");
    }
    const materials = materialIds.length
      ? await tx.material.findMany({
          where: { organizationId: input.organizationId, id: { in: materialIds } },
          select: { id: true, code: true },
        })
      : [];
    if (materials.length !== materialIds.length) throw new ExecutionError("有材料不属于当前组织，不能凭空复制一份");

    const existing = await tx.developmentProject.findMany({
      where: { organizationId: input.organizationId },
      select: { code: true },
    });
    const next =
      Math.max(
        0,
        ...existing.map((row) => Number(/^DEV-(\d+)$/.exec(row.code)?.[1] ?? 0)),
      ) + 1;
    const code = `DEV-${String(next).padStart(3, "0")}`;
    const unknowns = [
      styleId ? null : "尚未关联款号",
      materials.length ? null : "尚未引用材料",
      "手感待测",
      "不能投产",
    ].filter((item): item is string => Boolean(item));

    const project = await tx.developmentProject.create({
      data: {
        id: createId(),
        organizationId: input.organizationId,
        code,
        name,
        styleId,
        status: "open",
        unknownsJson: JSON.stringify(unknowns),
      },
    });
    for (const material of materials) {
      await tx.developmentCandidate.create({
        data: {
          id: createId(),
          projectId: project.id,
          kind: "material",
          materialId: material.id,
          copyMode: "reference",
          unconfirmedJson: JSON.stringify(["手感待测", "缩水待测", "历史批准不可沿用"]),
          note: "引用已有材料主档，不是采购，也不复制新材料",
        },
      });
    }
    await tx.taskItem.create({
      data: {
        id: createId(),
        organizationId: input.organizationId,
        title: "核对开发资料",
        kind: "development_review",
        status: "open",
        blocking: true,
        relatedStyleId: styleId,
        note: `${code} 人手新建，未批准，不能投产`,
      },
    });
    await writeAudit({
      organizationId: input.organizationId,
      actorUserId: input.userId,
      action: "development.created",
      entityType: "DevelopmentProject",
      entityId: project.id,
      summary: `已建开发款式 ${project.code}，材料仅为引用，未批准或采购`,
      payloadJson: JSON.stringify({
        actionType: ACTION_TYPES.createDevelopmentProject,
        code: project.code,
        styleId,
        materialIds,
        before: null,
        after: { projectId: project.id, code: project.code, name, styleId, materialIds, unknowns },
        basis: { input: "人工新建开发款式" },
      }),
    }, tx);
    return { projectId: project.id, projectCode: project.code };
  });
  const message = styleId
    ? `已建开发款式 ${result.projectCode}。材料仅为引用，不是批准，不能投产，没有采购。`
    : `已建开发款式 ${result.projectCode}。可先于款号存在，不是批准，不能投产，没有采购。`;
  return { ...result, message };
}
