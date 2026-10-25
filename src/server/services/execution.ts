import { lockOrganizationForWrite } from "./order-write";
import { ACTION_TYPES } from "@/lib/constants";
import { prisma } from "@/lib/db";
import { createId } from "@/lib/hash";
import { canApproveAction } from "@/server/permissions";
import { expireIfStale } from "@/server/services/decision-center";
import { getProductionGate } from "@/server/services/production-gate";

type Payload = {
  selectedStyleId: string;
  colors: Array<{ colorName: string; quantity: number }>;
  totalQuantity: number | string | null;
  deliveryText: string | null;
  deliveryDateInferred: string | null;
  deliveryYearInference: string | null;
  modifications: Array<{ field: string; requested: string }>;
  unknowns: string[];
};

export class ExecutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExecutionError";
  }
}

export async function approveProposal(input: {
  organizationId: string;
  userId: string;
  role: string;
  proposalId: string;
}) {
  const proposal = await prisma.actionProposal.findFirst({
    where: { id: input.proposalId, organizationId: input.organizationId },
    include: { execution: true, source: true },
  });
  if (!proposal) throw new ExecutionError("提案不存在或不属于当前组织");
  if (proposal.source.origin === "context-management") throw new ExecutionError("请在设置的企业上下文中核对差异并确认发布");
  if (proposal.source.origin === "pattern-assistant") throw new ExecutionError("请回到版单的问衣据入口，由发起人核对参考字段后确认采用");
  if (proposal.source.origin === "order-assistant") {
    throw new ExecutionError("请回到订单执行的一句话建单入口，由发起人核对后确认提交");
  }
  if (!canApproveAction(input.role, proposal.actionType)) {
    throw new ExecutionError("当前角色无权批准该动作");
  }
  if (proposal.status === "rejected") {
    throw new ExecutionError("提案已拒绝，不能再批准");
  }
  const freshness = await expireIfStale(input.organizationId, proposal.id);
  if (freshness?.status === "expired" || proposal.status === "expired") {
    throw new ExecutionError("提案已过期，请重新预览");
  }
  if (proposal.execution) {
    return { reused: true, execution: proposal.execution, result: JSON.parse(proposal.execution.resultJson) };
  }
  if (proposal.actionType === ACTION_TYPES.createDevelopmentProject) {
    return executeDevelopmentProject(input, proposal);
  }
  if (proposal.actionType === ACTION_TYPES.adoptPurchaseOption) {
    return executeAdoptPurchase(input, proposal);
  }
  if (proposal.actionType === ACTION_TYPES.createInternalTask) {
    return executeChainTask(input, proposal);
  }
  if (proposal.actionType === ACTION_TYPES.releaseToProduction) {
    return executeChainRelease(input, proposal);
  }
  if (proposal.actionType !== ACTION_TYPES.createOrderDraft) {
    throw new ExecutionError("不支持的动作类型");
  }

  const payload = JSON.parse(proposal.payloadJson) as Payload;
  const expected = JSON.parse(proposal.expectedJson) as {
    historicalOrderId?: string | null;
    historicalPo?: string | null;
    styleId: string;
  };

  if (payload.unknowns.includes("附件指令不是有效授权") && /release|purchase|密钥/.test(proposal.payloadJson)) {
    throw new ExecutionError("资料中的指令不能作为批准依据");
  }

  const result = await prisma.$transaction(async (tx) => {
    const style = await tx.style.findFirst({
      where: { id: payload.selectedStyleId, organizationId: input.organizationId },
    });
    if (!style) throw new ExecutionError("关联款式不存在");

    const approvedVersion = await tx.styleVersion.findFirst({
      where: { styleId: style.id, status: "approved" },
      orderBy: { versionNumber: "desc" },
    });
    if (!approvedVersion) throw new ExecutionError("找不到已批准资料版本，无法作为对照");

    const styleCountBefore = await tx.style.count({ where: { organizationId: input.organizationId } });
    const historical = expected.historicalOrderId
      ? await tx.salesOrder.findUnique({ where: { id: expected.historicalOrderId } })
      : null;

    const existingOrder = await tx.salesOrder.findFirst({
      where: { organizationId: input.organizationId, sourceDocumentId: proposal.sourceDocumentId },
      include: { lines: true },
    });
    if (existingOrder) {
      return {
        orderId: existingOrder.id,
        styleId: style.id,
        versionDraftId: existingOrder.lines[0]?.styleVersionId ?? null,
        reused: true,
      };
    }

    const orderCount = await tx.salesOrder.count({ where: { organizationId: input.organizationId } });
    const orderNo = `DEMO-ORD-${String(orderCount + 1).padStart(3, "0")}`;
    const latestVersion = await tx.styleVersion.findFirst({
      where: { styleId: style.id },
      orderBy: { versionNumber: "desc" },
      select: { versionNumber: true },
    });
    const nextVersionNumber = (latestVersion?.versionNumber ?? approvedVersion.versionNumber) + 1;
    const cuffRequested =
      payload.modifications.find((item) => item.field === "cuffType")?.requested ?? approvedVersion.cuffType;

    const versionDraft = await tx.styleVersion.create({
      data: {
        id: createId(),
        styleId: style.id,
        versionNumber: nextVersionNumber,
        status: "draft",
        cuffType: cuffRequested,
        constructionJson: approvedVersion.constructionJson,
        changeSummary: payload.modifications.some((item) => item.field === "colorway")
          ? "按新图变更颜色；旧样品批准不可沿用，不得作为正式生产依据"
          : "按本次翻单要求将袖口改为罗纹；规格与批准尚未提供，不得作为正式生产依据",
        sourceDocumentId: proposal.sourceDocumentId,
      },
    });

    const approvedBom = await tx.bomLine.findMany({ where: { styleVersionId: approvedVersion.id } });
    if (approvedBom.length) {
      await tx.bomLine.createMany({
        data: approvedBom.map((line) => ({
          id: createId(),
          styleVersionId: versionDraft.id,
          materialId: line.materialId,
          consumption: line.consumption,
          unit: line.unit,
          includesAllowance: line.includesAllowance,
          allowanceRate: line.allowanceRate,
          colorScope: line.colorScope,
          confirmed: false,
        })),
      });
    }

    const customer =
      (historical
        ? await tx.customer.findFirst({
            where: { id: historical.customerId, organizationId: input.organizationId },
          })
        : null) ??
      (await tx.customer.findFirst({
        where: { organizationId: input.organizationId, name: "北岸服饰" },
      }));
    if (!customer) throw new ExecutionError("未找到客户：北岸服饰");

    const totalQuantity = Number(payload.totalQuantity ?? 0);
    const order = await tx.salesOrder.create({
      data: {
        id: createId(),
        organizationId: input.organizationId,
        orderNo,
        customerId: customer.id,
        status: "draft",
        productionReadiness: "blocked_incomplete_spec",
        externalCustomerPo: null,
        requestedDeliveryText: payload.deliveryText ? String(payload.deliveryText) : null,
        requestedDeliveryDate: null,
        deliveryYearInference: payload.deliveryYearInference,
        sourceDocumentId: proposal.sourceDocumentId,
        createdByUserId: input.userId,
        notes: payload.modifications.some((item) => item.field === "colorway")
          ? "翻单草稿：新颜色未确认，尺码未齐，不能投产"
          : "翻单草稿：缺少尺码配比与罗纹规格，不能投产",
        lines: {
          create: {
            id: createId(),
            styleId: style.id,
            styleVersionId: versionDraft.id,
            totalQuantity,
            colors: {
              create: payload.colors.map((color) => ({
                id: createId(),
                colorName: color.colorName,
                quantity: color.quantity,
              })),
            },
          },
        },
      },
    });

    const tasks = [
      ...(payload.unknowns.includes("尺码明细")
        ? [{ title: "尺码未齐，暂不形成完整数量明细。", kind: "missing_size_breakdown" }]
        : []),
      ...(payload.unknowns.includes("罗纹规格与批准")
        ? [{ title: "确认罗纹规格并完成材料批准", kind: "missing_rib_spec" }]
        : []),
      ...(payload.deliveryYearInference || payload.deliveryDateInferred
        ? [{ title: "确认交期年份", kind: "missing_delivery_year" }]
        : []),
      ...(payload.unknowns.includes("新颜色未确认") || payload.modifications.some((item) => item.field === "colorway")
        ? [{ title: "新颜色尚未确认，不能沿用旧样品批准。", kind: "missing_approval" }]
        : []),
    ];
    for (const task of tasks) {
      await tx.taskItem.create({
        data: {
          id: createId(),
          organizationId: input.organizationId,
          title: task.title,
          kind: task.kind,
          status: "open",
          blocking: true,
          assigneeRole: "salesperson",
          relatedOrderId: order.id,
          relatedStyleId: style.id,
          sourceDocumentId: proposal.sourceDocumentId,
          note: "由资料闭环创建，不是投产批准",
        },
      });
    }

    await tx.actionProposal.update({
      where: { id: proposal.id },
      data: { status: "executed", decidedAt: new Date(), decidedById: input.userId },
    });

    const result = {
      orderId: order.id,
      orderNo,
      styleId: style.id,
      versionDraftId: versionDraft.id,
      styleCountBefore,
      styleCountAfter: await tx.style.count({ where: { organizationId: input.organizationId } }),
      historicalOrderSnapshot: historical
        ? {
            id: historical.id,
            externalCustomerPo: historical.externalCustomerPo,
            status: historical.status,
          }
        : null,
      approvedVersionId: approvedVersion.id,
      productionReadiness: "blocked_incomplete_spec",
    };

    await tx.actionExecution.create({
      data: {
        id: createId(),
        proposalId: proposal.id,
        executedById: input.userId,
        status: "succeeded",
        resultJson: JSON.stringify(result),
      },
    });

    await tx.auditEvent.create({
      data: {
        id: createId(),
        organizationId: input.organizationId,
        actorUserId: input.userId,
        actorType: "user",
        action: "proposal.executed",
        entityType: "SalesOrder",
        entityId: order.id,
        summary: `已创建订单草稿 ${orderNo}，未投产，未修改历史资料`,
        payloadJson: JSON.stringify(result),
      },
    });

    await tx.sourceDocument.update({
      where: { id: proposal.sourceDocumentId },
      data: { parseStatus: "succeeded" },
    });
    await tx.aiJob.update({
      where: { id: proposal.aiJobId },
      data: { status: "succeeded" },
    });

    return result;
  });

  return { reused: false, execution: null, result };
}

async function executeDevelopmentProject(
  input: { organizationId: string; userId: string },
  proposal: { id: string; sourceDocumentId: string; aiJobId: string; payloadJson: string },
) {
  const payload = JSON.parse(proposal.payloadJson) as {
    materials: Array<{ code: string }>;
    unknowns: string[];
    customerName: string | null;
  };
  const result = await prisma.$transaction(async (tx) => {
    const existing = await tx.developmentProject.findFirst({
      where: { organizationId: input.organizationId, sourceDocumentId: proposal.sourceDocumentId },
    });
    if (existing) {
      return { projectId: existing.id, reused: true };
    }
    const count = await tx.developmentProject.count({ where: { organizationId: input.organizationId } });
    const customer = payload.customerName
      ? await tx.customer.findFirst({
          where: { organizationId: input.organizationId, name: String(payload.customerName) },
        })
      : null;
    const project = await tx.developmentProject.create({
      data: {
        id: createId(),
        organizationId: input.organizationId,
        code: `DEV-${String(count + 1).padStart(3, "0")}`,
        name: "轻薄圆领针织上衣材料开发",
        customerId: customer?.id ?? null,
        styleId: null,
        sourceDocumentId: proposal.sourceDocumentId,
        status: "open",
        unknownsJson: JSON.stringify(payload.unknowns ?? []),
      },
    });
    for (const item of payload.materials ?? []) {
      const material = await tx.material.findFirst({
        where: { organizationId: input.organizationId, code: item.code },
      });
      if (!material) throw new ExecutionError(`未找到材料 ${item.code}，拒绝凭空复制一份`);
      await tx.developmentCandidate.create({
        data: {
          id: createId(),
          projectId: project.id,
          kind: "material",
          materialId: material.id,
          copyMode: "reference",
          unconfirmedJson: JSON.stringify(["手感待测", "缩水待测", "历史客户批准不可沿用"]),
          note: "引用已有材料主档，不复制新材料",
        },
      });
    }
    await tx.taskItem.create({
      data: {
        id: createId(),
        organizationId: input.organizationId,
        title: "完成纱线手感与缩水试验",
        kind: "material_test_pending",
        status: "open",
        blocking: true,
        relatedStyleId: null,
        sourceDocumentId: proposal.sourceDocumentId,
        note: `开发款式 ${project.code}`,
      },
    });
    await tx.actionProposal.update({
      where: { id: proposal.id },
      data: { status: "executed", decidedAt: new Date(), decidedById: input.userId },
    });
    const created = { projectId: project.id, projectCode: project.code, styleId: null };
    await tx.actionExecution.create({
      data: {
        id: createId(),
        proposalId: proposal.id,
        executedById: input.userId,
        status: "succeeded",
        resultJson: JSON.stringify(created),
      },
    });
    await tx.sourceDocument.update({
      where: { id: proposal.sourceDocumentId },
      data: { parseStatus: "succeeded" },
    });
    await tx.aiJob.update({
      where: { id: proposal.aiJobId },
      data: { status: "succeeded" },
    });
    await tx.auditEvent.create({
      data: {
        id: createId(),
        organizationId: input.organizationId,
        actorUserId: input.userId,
        actorType: "user",
        action: "development.created",
        entityType: "DevelopmentProject",
        entityId: project.id,
        summary: `已创建开发款式 ${project.code}，未建款号，材料仅为引用`,
      },
    });
    return created;
  });
  return { reused: false, execution: null, result };
}

async function markProposalExecuted(
  input: { organizationId: string; userId: string },
  proposal: { id: string; actionType: string; sourceDocumentId: string; aiJobId: string },
  result: Record<string, unknown>,
  summary: string,
) {
  await prisma.actionProposal.update({
    where: { id: proposal.id },
    data: { status: "executed", decidedAt: new Date(), decidedById: input.userId },
  });
  await prisma.actionExecution.create({
    data: {
      id: createId(),
      proposalId: proposal.id,
      executedById: input.userId,
      status: "succeeded",
      resultJson: JSON.stringify(result),
    },
  });
  await prisma.auditEvent.create({
    data: {
      id: createId(),
      organizationId: input.organizationId,
      actorUserId: input.userId,
      actorType: "user",
      action: "proposal.executed",
      entityType: "ActionProposal",
      entityId: proposal.id,
      summary,
      payloadJson: JSON.stringify(result),
    },
  });
}

async function executeAdoptPurchase(
  input: { organizationId: string; userId: string; role: string },
  proposal: { id: string; actionType: string; payloadJson: string; sourceDocumentId: string; aiJobId: string },
) {
  const payload = JSON.parse(proposal.payloadJson) as {
    orderId?: string;
    materialId?: string;
    optionCode?: "A" | "B";
    expectedSnapshot?: string;
  };
  if (!payload.orderId || !payload.materialId || !payload.optionCode || !payload.expectedSnapshot) {
    throw new ExecutionError("余料提案缺少订单或方案快照");
  }
  const { adoptPurchaseOption } = await import("@/server/services/adopt-purchase-option");
  const adopted = await adoptPurchaseOption({
    organizationId: input.organizationId,
    userId: input.userId,
    role: input.role,
    orderId: payload.orderId,
    materialId: payload.materialId,
    optionCode: payload.optionCode,
    expectedSnapshot: payload.expectedSnapshot,
  });
  const result = { ...adopted, orderId: payload.orderId, poIssued: false };
  await markProposalExecuted(
    input,
    proposal,
    result,
    adopted.reused
      ? `余料方案 ${payload.optionCode} 已采用，未重复占库，未下达采购`
      : `已采用余料方案 ${payload.optionCode}，占住可分配库存，未下达采购`,
  );
  return { reused: adopted.reused, execution: null, result };
}

async function executeChainTask(
  input: { organizationId: string; userId: string },
  proposal: { id: string; actionType: string; payloadJson: string; sourceDocumentId: string; aiJobId: string },
) {
  const payload = JSON.parse(proposal.payloadJson) as {
    orderId?: string;
    taskKind?: string;
    materialId?: string;
    currency?: string;
    title?: string;
  };
  const allowed = new Set(["chain_over_use", "chain_transfer", "chain_consume", "chain_collect"]);
  if (!payload.orderId || !payload.taskKind || !allowed.has(payload.taskKind)) {
    throw new ExecutionError("内部任务提案缺少本单核对种类");
  }
  const existing = await prisma.taskItem.findFirst({
    where: {
      organizationId: input.organizationId,
      relatedOrderId: payload.orderId,
      kind: payload.taskKind,
      status: "open",
    },
  });
  const task =
    existing ??
    (await prisma.taskItem.create({
      data: {
        id: createId(),
        organizationId: input.organizationId,
        title: payload.title ?? "核对本单链上事项",
        kind: payload.taskKind,
        status: "open",
        blocking: false,
        assigneeRole: "salesperson",
        relatedOrderId: payload.orderId,
        sourceDocumentId: proposal.sourceDocumentId,
        note: payload.materialId
          ? `材料 ${payload.materialId}。调拨不是领用，不自动改库存。`
          : "核销登记不是银行执行。正式采购与真付款未下达。",
      },
    }));
  const result = { orderId: payload.orderId, taskId: task.id, reused: Boolean(existing) };
  await markProposalExecuted(input, proposal, result, existing ? "核对任务已在，未重复创建" : `已创建内部核对任务，不挡投产`);
  return { reused: Boolean(existing), execution: null, result };
}

async function executeChainRelease(
  input: { organizationId: string; userId: string; role: string },
  proposal: { id: string; actionType: string; payloadJson: string; sourceDocumentId: string; aiJobId: string },
) {
  const payload = JSON.parse(proposal.payloadJson) as { orderId?: string };
  if (!payload.orderId) throw new ExecutionError("投产提案缺少订单");
  const released = await releaseToProduction({
    organizationId: input.organizationId,
    userId: input.userId,
    role: input.role,
    orderId: payload.orderId,
  });
  const result = { ...released, orderId: payload.orderId };
  await markProposalExecuted(input, proposal, result, released.message);
  return { reused: released.reused, execution: null, result };
}

export async function rejectProposal(input: {
  organizationId: string;
  userId: string;
  role: string;
  proposalId: string;
}) {
  const proposal = await prisma.actionProposal.findFirst({
    where: { id: input.proposalId, organizationId: input.organizationId },
    include: { execution: true },
  });
  if (!proposal) throw new ExecutionError("提案不存在或不属于当前组织");
  if (!canApproveAction(input.role, proposal.actionType)) {
    throw new ExecutionError("当前角色无权拒绝该动作");
  }
  if (proposal.execution || proposal.status === "executed") {
    throw new ExecutionError("提案已执行，不能拒绝");
  }
  if (proposal.status === "rejected") {
    return { reused: true, proposalId: proposal.id, status: "rejected" as const };
  }
  await prisma.actionProposal.update({
    where: { id: proposal.id },
    data: { status: "rejected", decidedAt: new Date(), decidedById: input.userId },
  });
  await prisma.auditEvent.create({
    data: {
      id: createId(),
      organizationId: input.organizationId,
      actorUserId: input.userId,
      actorType: "user",
      action: "proposal.rejected",
      entityType: "ActionProposal",
      entityId: proposal.id,
      summary: `已拒绝 ${proposal.actionType}，未写入业务记录`,
    },
  });
  return { reused: false, proposalId: proposal.id, status: "rejected" as const };
}

export async function assertCannotReleaseToProduction(orderId: string) {
  const order = await prisma.salesOrder.findUniqueOrThrow({ where: { id: orderId } });
  const gate = await getProductionGate(order.organizationId, orderId);
  if (gate.alreadyReleased) return true;
  throw new ExecutionError(gate.alreadyDone ? "已出运，不能批准投产" : `${gate.label}，不能批准投产`);
}

export async function releaseToProduction(input: {
  organizationId: string;
  userId: string;
  role: string;
  orderId: string;
  expectedUpdatedAt?: string;
}) {
  if (!canApproveAction(input.role, ACTION_TYPES.releaseToProduction)) {
    throw new ExecutionError("无权批准投产");
  }
  return prisma.$transaction(async (tx) => {
    await lockOrganizationForWrite(tx, input.organizationId);
    const actor = await tx.user.findFirst({ where: { id: input.userId, organizationId: input.organizationId, active: true, role: input.role } });
    if (!actor) throw new ExecutionError("当前账号无权批准投产");
    const gate = await getProductionGate(input.organizationId, input.orderId, tx);
    if (input.expectedUpdatedAt && input.expectedUpdatedAt !== gate.updatedAt) throw new ExecutionError("资料已被他人修改，请刷新后重试");
    if (gate.alreadyDone) throw new ExecutionError("已出运，不能批准投产");
    if (!gate.ready) throw new ExecutionError(`${gate.label}，不能批准投产`);
    const latest = await tx.salesOrder.findFirst({
      where: { id: input.orderId, organizationId: input.organizationId },
    });
    if (!latest) throw new ExecutionError("订单不存在或不属于当前组织");
    if (input.expectedUpdatedAt && latest.updatedAt.toISOString() !== input.expectedUpdatedAt) {
      throw new ExecutionError("资料已被他人修改，请刷新后重试");
    }
    if (latest.productionReadiness === "ready_for_production") {
      return {
        reused: true,
        orderId: latest.id,
        productionReadiness: "ready_for_production" as const,
        message: "已可投产，未重复批准",
      };
    }

    await tx.salesOrder.update({
      where: { id: latest.id },
      data: {
        productionReadiness: "ready_for_production",
        notes: "门槛已齐，经理批准投产。正式采购未下达。",
      },
    });
    await tx.auditEvent.create({
      data: {
        id: createId(),
        organizationId: input.organizationId,
        actorUserId: input.userId,
        actorType: "user",
        action: ACTION_TYPES.releaseToProduction,
        entityType: "SalesOrder",
        entityId: latest.id,
        summary: `已批准投产 ${latest.orderNo}。资料、分色、厂里有可用料已齐。正式采购未下达。`,
        payloadJson: JSON.stringify({
          before: { productionReadiness: latest.productionReadiness },
          after: { productionReadiness: "ready_for_production" },
          checks: gate.checks,
          blockers: gate.blockers,
        }),
      },
    });
    return {
      reused: false,
      orderId: latest.id,
      productionReadiness: "ready_for_production" as const,
      message: "已批准投产。进度台可登记产量。正式采购未下达。",
    };
  });
}
