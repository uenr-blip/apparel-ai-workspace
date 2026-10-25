import { prisma } from "@/lib/db";
import type { Prisma } from "@prisma/client";
import { d, grossRequirementMeters } from "@/server/domain/procurement";
import { ExecutionError } from "@/server/services/execution";
import { isRecordedConsumption } from "@/server/services/style-bom";

export type MaterialPlanLineStatus = "calculated" | "pending_consumption" | "unsupported_unit";

export type MaterialPlanLine = {
  materialId: string;
  materialCode: string;
  materialName: string;
  unit: string;
  consumption: string;
  consumptionConfirmed: boolean;
  quantityPieces: number;
  status: MaterialPlanLineStatus;
  gross: string | null;
  note: string;
};

export type OrderMaterialPlan = {
  orderId: string;
  orderNo: string;
  quantityPieces: number;
  mode: "rule_calculated";
  stockDeducted: false;
  purchaseSuggested: false;
  lines: MaterialPlanLine[];
  facts: string[];
};

type BomForPlan = {
  materialId: string;
  consumption: string;
  unit: string;
  includesAllowance: boolean;
  allowanceRate: string;
  confirmed: boolean;
  material: { code: string; name: string };
};

export function planFactsForLines(lines: MaterialPlanLine[], emptyBom: boolean) {
  if (emptyBom) return ["无面辅料，不能算毛需求"];
  return lines.map((line) => {
    if (line.status === "pending_consumption") return `${line.materialCode} 单耗未确认，不能算毛需求`;
    if (line.status === "unsupported_unit") return `${line.materialCode} 该单位毛需求算法未开通`;
    return `毛需求 ${line.materialCode} ${line.gross} ${line.unit}（规则计算，未扣库存，不是采购建议）`;
  });
}

export function computeMaterialPlanLines(quantityPieces: number, bomLines: BomForPlan[]): MaterialPlanLine[] {
  return bomLines.map((line) => {
    const base = {
      materialId: line.materialId,
      materialCode: line.material.code,
      materialName: line.material.name,
      unit: line.unit,
      consumption: line.consumption,
      consumptionConfirmed: line.confirmed,
      quantityPieces,
    };
    if (!isRecordedConsumption(line.consumption)) {
      return {
        ...base,
        status: "pending_consumption" as const,
        gross: null,
        note: "单耗未确认，不能算毛需求",
      };
    }
    if (line.unit !== "m") {
      return {
        ...base,
        status: "unsupported_unit" as const,
        gross: null,
        note: "该单位毛需求算法未开通",
      };
    }
    const gross = grossRequirementMeters({
      quantityPieces,
      consumption: line.consumption,
      allowanceRate: line.allowanceRate,
      includesAllowance: line.includesAllowance,
    });
    return {
      ...base,
      status: "calculated" as const,
      gross,
      note: "规则计算，未扣库存，不是采购建议",
    };
  });
}

function mergePlanLines(left: MaterialPlanLine, right: MaterialPlanLine): MaterialPlanLine {
  const quantityPieces = left.quantityPieces + right.quantityPieces;
  if (left.status === "pending_consumption" || right.status === "pending_consumption") {
    return { ...left, quantityPieces, status: "pending_consumption", gross: null, note: "单耗未确认，不能算毛需求" };
  }
  if (left.status === "unsupported_unit" || right.status === "unsupported_unit") {
    return { ...left, quantityPieces, status: "unsupported_unit", gross: null, note: "该单位毛需求算法未开通" };
  }
  return {
    ...left,
    consumptionConfirmed: left.consumptionConfirmed && right.consumptionConfirmed,
    quantityPieces,
    gross: d(left.gross ?? 0)
      .plus(right.gross ?? 0)
      .toDecimalPlaces(0)
      .toFixed(0),
  };
}

export function aggregateMaterialPlan(orderLines: Array<{ totalQuantity: number; bomLines: BomForPlan[] }>) {
  const quantityPieces = orderLines.reduce((sum, line) => sum + line.totalQuantity, 0);
  const byMaterial = new Map<string, MaterialPlanLine>();
  let bomCount = 0;
  for (const line of orderLines) {
    bomCount += line.bomLines.length;
    for (const planned of computeMaterialPlanLines(line.totalQuantity, line.bomLines)) {
      const existing = byMaterial.get(planned.materialId);
      byMaterial.set(planned.materialId, existing ? mergePlanLines(existing, planned) : planned);
    }
  }
  const lines = [...byMaterial.values()];
  return {
    quantityPieces,
    lines,
    facts: planFactsForLines(lines, bomCount === 0),
  };
}

export async function getOrderMaterialPlan(organizationId: string, orderId: string, client: Pick<Prisma.TransactionClient, "salesOrder"> = prisma): Promise<OrderMaterialPlan> {
  const order = await client.salesOrder.findFirst({
    where: { id: orderId, organizationId },
    include: {
      lines: {
        include: {
          version: { include: { bomLines: { include: { material: true } } } },
        },
      },
    },
  });
  if (!order) throw new ExecutionError("订单不存在或不属于当前组织");

  const aggregated = aggregateMaterialPlan(
    order.lines.map((line) => ({
      totalQuantity: line.totalQuantity,
      bomLines: line.version?.bomLines ?? [],
    })),
  );

  return {
    orderId: order.id,
    orderNo: order.orderNo,
    quantityPieces: aggregated.quantityPieces,
    mode: "rule_calculated",
    stockDeducted: false,
    purchaseSuggested: false,
    lines: aggregated.lines,
    facts: aggregated.facts,
  };
}
