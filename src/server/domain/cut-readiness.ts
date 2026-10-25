import { d } from "@/server/domain/procurement";

export type CutStatus = "ready" | "blocked" | "unknown";

export type CutPlanLine = {
  materialId: string;
  materialCode: string;
  materialName: string;
  unit: string;
  gross: string | null;
  status: "calculated" | "pending_consumption" | "unsupported_unit";
};

export type CutLot = {
  materialId: string;
  locationId: string;
  locationKind: string;
  qtyOnHand: string;
  qtyAllocated: string;
  allocatedToOrder: string;
  consumedOnOrder: string;
  qualityStatus: string;
  ownerKind: string;
};

export type CutSupplyLine = {
  materialId: string;
  materialCode: string;
  materialName: string;
  unit: string;
  gross: string | null;
  companyOnHand: string;
  allocatedToOrder: string;
  atFactory: string;
  consumed: string;
  remaining: string | null;
  blocker: string | null;
};

export type CutSupplySummary = {
  status: CutStatus;
  canCut: boolean;
  label: string;
  blockers: string[];
  lines: CutSupplyLine[];
};

function qty0(value: Parameters<typeof d>[0]) {
  const next = d(value);
  return next.isNegative() ? d(0) : next;
}

function eligibleOnHand(lot: CutLot) {
  if (lot.ownerKind !== "company" || lot.qualityStatus !== "qualified") return d(0);
  const others = qty0(d(lot.qtyAllocated).minus(lot.allocatedToOrder || 0));
  return qty0(d(lot.qtyOnHand).minus(others));
}

export function evaluateCutSupply(input: {
  factoryId: string | null;
  started: boolean;
  lines: CutPlanLine[];
  lots: CutLot[];
}): CutSupplySummary {
  const lines: CutSupplyLine[] = input.lines.map((line) => {
    const lots = input.lots.filter((lot) => lot.materialId === line.materialId);
    const companyOnHand = lots.reduce((sum, lot) => {
      if (lot.ownerKind !== "company" || lot.qualityStatus !== "qualified") return sum;
      return sum.plus(qty0(lot.qtyOnHand));
    }, d(0));
    const allocatedToOrder = lots.reduce((sum, lot) => sum.plus(qty0(lot.allocatedToOrder)), d(0));
    const atFactory = lots.reduce((sum, lot) => {
      if (!input.factoryId || lot.locationId !== input.factoryId) return sum;
      return sum.plus(eligibleOnHand(lot));
    }, d(0));
    const consumed = lots.reduce((sum, lot) => sum.plus(qty0(lot.consumedOnOrder)), d(0));
    const warehouseAvailable = lots.reduce((sum, lot) => {
      if (lot.locationKind === "factory") return sum;
      return sum.plus(eligibleOnHand(lot));
    }, d(0));

    if (line.status !== "calculated" || !line.gross) {
      return {
        materialId: line.materialId,
        materialCode: line.materialCode,
        materialName: line.materialName,
        unit: line.unit,
        gross: line.gross,
        companyOnHand: companyOnHand.toFixed(0),
        allocatedToOrder: allocatedToOrder.toFixed(0),
        atFactory: atFactory.toFixed(0),
        consumed: consumed.toFixed(0),
        remaining: null,
        blocker: line.status === "pending_consumption" ? "单耗未确认" : "毛需求未知",
      };
    }

    const remaining = qty0(d(line.gross).minus(consumed));
    let blocker: string | null = null;
    if (remaining.lte(0) || atFactory.gte(remaining)) blocker = null;
    else if (atFactory.plus(warehouseAvailable).gte(remaining)) blocker = "未调到厂";
    else blocker = "未到料";

    return {
      materialId: line.materialId,
      materialCode: line.materialCode,
      materialName: line.materialName,
      unit: line.unit,
      gross: line.gross,
      companyOnHand: companyOnHand.toFixed(0),
      allocatedToOrder: allocatedToOrder.toFixed(0),
      atFactory: atFactory.toFixed(0),
      consumed: consumed.toFixed(0),
      remaining: remaining.toFixed(0),
      blocker,
    };
  });

  if (input.started) {
    return { status: "ready", canCut: true, label: "已开裁", blockers: [], lines };
  }

  if (!input.lines.length) {
    return {
      status: "unknown",
      canCut: false,
      label: "本单草稿没有面辅料",
      blockers: ["本单草稿没有面辅料"],
      lines,
    };
  }

  const unknown = lines.some((line) => line.remaining === null);
  const blockers = [...new Set(lines.map((line) => line.blocker).filter((item): item is string => Boolean(item)))];
  if (unknown && blockers.every((item) => item === "单耗未确认" || item === "毛需求未知")) {
    return { status: "unknown", canCut: false, label: "单耗未确认，不能判断开裁", blockers, lines };
  }
  if (blockers.length) {
    return { status: "blocked", canCut: false, label: blockers.join(" · "), blockers, lines };
  }
  return { status: "ready", canCut: true, label: "可开裁", blockers: [], lines };
}
