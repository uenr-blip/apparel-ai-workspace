import { ACTION_TYPES } from "@/lib/constants";
import { prisma } from "@/lib/db";
import { createId } from "@/lib/hash";
import { canApproveAction } from "@/server/permissions";
import { ExecutionError } from "@/server/services/execution";

export type ColorConfirmationStatus = "approved" | "rejected";

export type ColorConfirmationEntry = {
  id: string;
  round: number;
  status: ColorConfirmationStatus;
  evidence: string;
  materialId: string | null;
  materialCode: string | null;
  createdAt: string;
};

export type ColorConfirmationRow = {
  colorName: string;
  latest: ColorConfirmationEntry | null;
  history: ColorConfirmationEntry[];
};

export type ColorConfirmationBoard = {
  orderId: string;
  orderNo: string;
  defaultMaterialId: string | null;
  allColorsLatestApproved: boolean;
  headline: string;
  facts: string[];
  imageJudgement: false;
  colors: ColorConfirmationRow[];
};

function colorNamesFromOrder(order: { lines: Array<{ colors: Array<{ colorName: string }> }> }) {
  return [...new Set(order.lines.flatMap((line) => line.colors.map((color) => color.colorName)))];
}

function summarizeColors(colors: ColorConfirmationRow[]) {
  const facts = colors.map((row) => {
    if (!row.latest) return `${row.colorName}尚未确认`;
    if (row.latest.status === "rejected") return `${row.colorName}第 ${row.latest.round} 轮退回`;
    return `${row.colorName}已批准`;
  });
  const allColorsLatestApproved = colors.length > 0 && colors.every((row) => row.latest?.status === "approved");
  const headline = allColorsLatestApproved ? "各色最新一轮均已批准" : facts.join("，");
  return { facts, allColorsLatestApproved, headline };
}

export function colorConfirmationFacts(records: Array<{ colorName: string; round: number; status: string }>) {
  const latest = new Map<string, { colorName: string; round: number; status: string }>();
  for (const row of [...records].sort((left, right) => left.round - right.round)) {
    latest.set(row.colorName, row);
  }
  return [...latest.values()].map((row) =>
    row.status === "rejected" ? `${row.colorName}第 ${row.round} 轮退回` : `${row.colorName}已批准`,
  );
}

function toEntry(
  row: { id: string; round: number; status: string; evidence: string; materialId: string | null; createdAt: Date },
  materialCode: string | null,
): ColorConfirmationEntry {
  return {
    id: row.id,
    round: row.round,
    status: row.status === "rejected" ? "rejected" : "approved",
    evidence: row.evidence,
    materialId: row.materialId,
    materialCode,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function getColorConfirmationBoard(organizationId: string, orderId: string): Promise<ColorConfirmationBoard> {
  const order = await prisma.salesOrder.findFirst({
    where: { id: orderId, organizationId },
    include: {
      lines: {
        include: {
          colors: true,
          version: { include: { bomLines: true } },
        },
      },
    },
  });
  if (!order) throw new ExecutionError("订单不存在或不属于当前组织");

  const records = await prisma.confirmationRecord.findMany({
    where: { orderId: order.id },
    orderBy: [{ colorName: "asc" }, { round: "asc" }, { createdAt: "asc" }],
  });
  const materialIds = [
    ...new Set(
      [
        ...records.map((row) => row.materialId),
        ...order.lines.flatMap((line) => line.version?.bomLines.map((bom) => bom.materialId) ?? []),
      ].filter((id): id is string => Boolean(id)),
    ),
  ];
  const materials = materialIds.length
    ? await prisma.material.findMany({ where: { organizationId, id: { in: materialIds } } })
    : [];
  const materialById = new Map(materials.map((row) => [row.id, row]));

  const colors = colorNamesFromOrder(order).map((colorName) => {
    const history = records
      .filter((row) => row.colorName === colorName)
      .map((row) => toEntry(row, row.materialId ? (materialById.get(row.materialId)?.code ?? null) : null));
    return { colorName, history, latest: history.at(-1) ?? null };
  });
  const summary = summarizeColors(colors);

  return {
    orderId: order.id,
    orderNo: order.orderNo,
    defaultMaterialId: materialIds[0] ?? null,
    allColorsLatestApproved: summary.allColorsLatestApproved,
    headline: summary.headline,
    facts: summary.facts,
    imageJudgement: false,
    colors,
  };
}

export async function submitColorConfirmation(input: {
  organizationId: string;
  userId: string;
  role: string;
  orderId: string;
  materialId: string;
  colorName: string;
  status: ColorConfirmationStatus;
  evidence: string;
}) {
  if (!canApproveAction(input.role, ACTION_TYPES.recordColorConfirmation)) {
    throw new ExecutionError("当前角色无权记录颜色确认");
  }
  if (input.status !== "approved" && input.status !== "rejected") {
    throw new ExecutionError("确认结果只能是批准或退回");
  }
  const evidence = input.evidence.trim();
  if (!evidence) throw new ExecutionError("请填写确认依据");

  const order = await prisma.salesOrder.findFirst({
    where: { id: input.orderId, organizationId: input.organizationId },
    include: { lines: { include: { colors: true } }, tasks: true },
  });
  if (!order) throw new ExecutionError("订单不存在或不属于当前组织");
  const colorName = input.colorName.trim();
  if (!colorNamesFromOrder(order).includes(colorName)) {
    throw new ExecutionError("颜色不在当前订单");
  }

  const material = await prisma.material.findFirst({
    where: { id: input.materialId, organizationId: input.organizationId },
  });
  if (!material) throw new ExecutionError("材料不存在或不属于当前组织");

  const actor = await prisma.user.findFirst({
    where: { id: input.userId, organizationId: input.organizationId },
  });

  return prisma.$transaction(async (tx) => {
    const previous = await tx.confirmationRecord.aggregate({
      where: { orderId: order.id, colorName, materialId: material.id },
      _max: { round: true },
    });
    const round = (previous._max.round ?? 0) + 1;
    await tx.confirmationRecord.create({
      data: {
        id: createId(),
        orderId: order.id,
        materialId: material.id,
        colorName,
        round,
        status: input.status,
        evidence,
      },
    });

    const records = await tx.confirmationRecord.findMany({
      where: { orderId: order.id },
      orderBy: [{ colorName: "asc" }, { round: "asc" }, { createdAt: "asc" }],
    });
    const colors = colorNamesFromOrder(order).map((name) => {
      const history = records.filter((row) => row.colorName === name).map((row) => toEntry(row, material.code));
      return { colorName: name, history, latest: history.at(-1) ?? null };
    });
    const summary = summarizeColors(colors);

    const mutable = order.productionReadiness === "blocked_color_approval" || order.productionReadiness === "color_approved";
    let nextReadiness = order.productionReadiness;
    if (mutable) {
      nextReadiness = summary.allColorsLatestApproved ? "color_approved" : "blocked_color_approval";
    }

    if (order.tasks.some((task) => task.kind === "missing_approval")) {
      await tx.taskItem.updateMany({
        where: { relatedOrderId: order.id, kind: "missing_approval" },
        data: {
          status: summary.allColorsLatestApproved ? "done" : "open",
          note: summary.headline,
        },
      });
    }

    const message = summary.allColorsLatestApproved
      ? "已按色记录确认。分色最新一轮均已批准，不能投产，也不是图片识别终审。"
      : "已按色记录确认。历史轮次保留，整单仍未按各色全部通过。";

    await tx.salesOrder.update({
      where: { id: order.id },
      data: { productionReadiness: nextReadiness, notes: message },
    });
    await tx.auditEvent.create({
      data: {
        id: createId(),
        organizationId: input.organizationId,
        actorUserId: input.userId,
        actorType: "user",
        action: "color_confirmation.recorded",
        entityType: "SalesOrder",
        entityId: order.id,
        summary: `${colorName}第 ${round} 轮${input.status === "approved" ? "批准" : "退回"}（${actor?.name ?? "业务员"}）`,
        payloadJson: JSON.stringify({
          colorName,
          materialId: material.id,
          round,
          status: input.status,
          imageJudgement: false,
        }),
      },
    });

    return {
      orderId: order.id,
      round,
      status: input.status,
      allColorsLatestApproved: summary.allColorsLatestApproved,
      headline: summary.headline,
      facts: summary.facts,
      productionReadiness: nextReadiness,
      message,
    };
  });
}
