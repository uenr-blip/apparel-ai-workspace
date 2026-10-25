import { ACTION_TYPES } from "@/lib/constants";
import type { Prisma } from "@prisma/client";
import { sha256 } from "@/lib/hash";
import { prisma } from "@/lib/db";
import { d, netRequirementMeters, purchaseLineAmountYuan, suggestedPurchaseMeters } from "@/server/domain/procurement";
import { ExecutionError } from "@/server/services/execution";
import { releaseOrderMaterialAllocations } from "@/server/services/inventory-alloc";
import { leftoverNextStep, type LeftoverNext } from "@/server/domain/leftover-next";
import { aggregateMaterialPlan, getOrderMaterialPlan, type MaterialPlanLine } from "@/server/services/material-plan";
import { writeAudit } from "@/server/services/intake";

export type PurchaseOption = {
  allocatedFree: string;
  reservedInbound: string;
  usesFreeStock: boolean;
  usesTimelyInbound: boolean;
  net: string;
  buy: string;
  amountYuan: string;
  plannedExcess: string;
  note: string;
};

export type PurchaseOptionLine = {
  snapshot: string;
  materialId: string;
  materialCode: string;
  materialName: string;
  unit: string;
  gross: string;
  freeStock: string;
  timelyInbound: string;
  lateInbound: string;
  optionA: PurchaseOption;
  optionB: PurchaseOption;
  spendDifferenceYuan: string;
  quoteVerified: boolean;
};

export type PurchaseOptionComparison = {
  orderId: string;
  orderNo: string;
  supplyNeedDate: string | null;
  poIssued: boolean;
  mode: "rule_calculated";
  adopted: {
    optionCode: string;
    materialId: string;
    qty: string;
    amountYuan: string;
    allocatedFree: string;
    reservedInbound: string;
    status: string;
    updatedAt: string;
    issued: boolean;
  } | null;
  lines: PurchaseOptionLine[];
  inboundLots: Array<{
    id: string;
    inboundNo: string | null;
    inboundEta: string | null;
    qtyInbound: string;
    materialCode: string;
  }>;
  next: LeftoverNext;
  facts: string[];
};

function supplyNeedDateFrom(order: { notes: string | null; requestedDeliveryDate: string | null }) {
  const match = order.notes?.match(/材料需求日\s*(\d{4}-\d{2}-\d{2})/);
  return match?.[1] ?? order.requestedDeliveryDate;
}

function eligibleQty(onHand: string, allocated: string) {
  return DecimalMax0(d(onHand).minus(allocated)).toFixed(0);
}

function DecimalMax0(value: ReturnType<typeof d>) {
  return value.isNegative() ? d(0) : value;
}

function option(input: {
  gross: string;
  free: string;
  inbound: string;
  usesFreeStock: boolean;
  usesTimelyInbound: boolean;
  moq: string;
  multiple: string;
  unitPriceYuan: string;
  note: string;
  alreadyReserved?: string;
}): PurchaseOption {
  const gross = DecimalMax0(d(input.gross));
  const reserved = DecimalMax0(d(input.alreadyReserved ?? "0"));
  const free = (input.usesFreeStock ? d(input.free).clamp(0, gross) : d(0)).toFixed(0);
  const inboundRoom = DecimalMax0(gross.minus(free).minus(reserved));
  const inbound = (input.usesTimelyInbound ? d(input.inbound).clamp(0, inboundRoom) : d(0)).toFixed(0);
  const net = netRequirementMeters({
    gross: input.gross,
    eligibleFreeStock: d(free).plus(reserved).toFixed(0),
    eligibleTimelyInbound: inbound,
  });
  const buy = suggestedPurchaseMeters({ net, moq: input.moq, multiple: input.multiple });
  const plannedExcess = d(buy).plus(free).plus(reserved).plus(inbound).minus(input.gross).toFixed(0);
  return {
    allocatedFree: free,
    reservedInbound: inbound,
    usesFreeStock: input.usesFreeStock,
    usesTimelyInbound: input.usesTimelyInbound,
    net,
    buy,
    amountYuan: purchaseLineAmountYuan(buy, input.unitPriceYuan),
    plannedExcess,
    note: input.note,
  };
}

type PurchaseReader = Pick<Prisma.TransactionClient, "salesOrder" | "styleVersion" | "inventoryLot" | "inventoryAllocation" | "supplierQuote" | "purchaseDraft">;

export async function getPurchaseOptions(organizationId: string, orderId: string, client: PurchaseReader = prisma): Promise<PurchaseOptionComparison> {
  const order = await client.salesOrder.findFirst({
    where: { id: orderId, organizationId },
    include: { lines: true },
  });
  if (!order) throw new ExecutionError("订单不存在或不属于当前组织");

  const plan = await getOrderMaterialPlan(organizationId, orderId, client);
  let planLines: MaterialPlanLine[] = plan.lines;
  const calculated = planLines.filter((line) => line.status === "calculated" && line.gross);
  if (!calculated.length && order.lines.length) {
    const styleIds = [...new Set(order.lines.map((line) => line.styleId))];
    const approved = await client.styleVersion.findMany({
      where: { styleId: { in: styleIds }, status: "approved" },
      include: { bomLines: { include: { material: true } } },
      orderBy: { versionNumber: "desc" },
    });
    const byStyle = new Map<string, (typeof approved)[number]>();
    for (const version of approved) {
      if (!byStyle.has(version.styleId)) byStyle.set(version.styleId, version);
    }
    const fallback = aggregateMaterialPlan(
      order.lines.map((line) => ({
        totalQuantity: line.totalQuantity,
        bomLines: byStyle.get(line.styleId)?.bomLines ?? [],
      })),
    );
    if (fallback.lines.some((line) => line.status === "calculated" && line.gross)) {
      planLines = fallback.lines;
    }
  }
  const supplyNeedDate = supplyNeedDateFrom(order);
  const facts: string[] = [
    "规则计算，未下达采购。差额不是利润，也不是总成本节省。",
    "未收货不能计作现货，更不能直接发料。",
  ];
  if (plan.lines.every((line) => line.status !== "calculated") && planLines.some((line) => line.status === "calculated")) {
    facts.push("本单当前资料草稿无面辅料，比较按该款已批准资料计算");
  }
  if (!supplyNeedDate) facts.push("材料需求日待核实，在途是否及时无法判定");

  const inboundLots: PurchaseOptionComparison["inboundLots"] = [];
  const lines: PurchaseOptionLine[] = [];
  const materialIds = [...new Set(planLines.map(line => line.materialId))];
  // Query count stays constant as BOM line count grows.
  const allLots = await client.inventoryLot.findMany({
    where: { organizationId, materialId: { in: materialIds }, qualityStatus: "qualified", ownerKind: "company" },
    orderBy: { id: "asc" },
  });
  const allQuotes = await client.supplierQuote.findMany({
    where: { organizationId, materialId: { in: materialIds } },
    orderBy: [{ validFrom: "desc" }, { id: "asc" }],
  });
  const ownAllocations = await client.inventoryAllocation.findMany({
    where: { orderId, status: { in: ["held", "planned"] }, lot: { organizationId, materialId: { in: materialIds } } },
    orderBy: { id: "asc" },
  });
  const ownByLot = new Map<string, ReturnType<typeof d>>();
  for (const allocation of ownAllocations) {
    ownByLot.set(allocation.lotId, (ownByLot.get(allocation.lotId) ?? d(0)).plus(allocation.qty));
  }
  if (ownAllocations.length) facts.push("本单可用供给包含已经为本单预留的数量；其他订单不能重复占用");
  for (const planLine of planLines) {
    if (planLine.status !== "calculated" || !planLine.gross) {
      facts.push(`${planLine.materialCode} ${planLine.note}`);
      continue;
    }
    if (!planLine.consumptionConfirmed) {
      facts.push(`${planLine.materialCode} 单耗未确认，只能查看毛需求草稿，不能比较或占库`);
      continue;
    }
    const lots = allLots.filter(lot => lot.materialId === planLine.materialId);
    if (lots.some(lot => (ownByLot.get(lot.id) ?? d(0)).gt(lot.qtyAllocated))) {
      facts.push(`${planLine.materialCode} 占用流水与批次数量不一致，请先核对库存`);
      continue;
    }
    let freeStock = d(0);
    let ownOnHand = d(0);
    let timelyInbound = d(0);
    let lateInbound = d(0);
    for (const lot of lots) {
      const ownQty = ownByLot.get(lot.id) ?? d(0);
      const otherAllocated = d(lot.qtyAllocated).minus(ownQty).toFixed(0);
      if (lot.inboundEta) {
        const inboundQty = eligibleQty(lot.qtyInbound || "0", otherAllocated);
        const timely = supplyNeedDate ? lot.inboundEta <= supplyNeedDate : false;
        if (timely) timelyInbound = timelyInbound.plus(inboundQty);
        else lateInbound = lateInbound.plus(inboundQty);
        inboundLots.push({
          id: lot.id,
          inboundNo: lot.inboundNo,
          inboundEta: lot.inboundEta,
          qtyInbound: lot.qtyInbound,
          materialCode: planLine.materialCode,
        });
      } else if (!supplyNeedDate || lot.availableFrom <= supplyNeedDate) {
        const eligible = d(eligibleQty(lot.qtyOnHand, otherAllocated));
        freeStock = freeStock.plus(eligible);
        ownOnHand = ownOnHand.plus(ownQty.gt(eligible) ? eligible : ownQty);
      }
    }
    const quote = allQuotes.find(row => row.materialId === planLine.materialId);
    if (!quote) {
      facts.push(`${planLine.materialCode} 缺少已确认供方报价，采购金额待核实`);
      continue;
    }
    if (quote.unit !== planLine.unit || quote.currency !== "CNY") {
      facts.push(`${planLine.materialCode} 报价单位或币种不一致，缺少已批准换算依据，不能比较`);
      continue;
    }
    let validQuote = false;
    try {
      validQuote = Number.isSafeInteger(quote.unitPriceMinor) && quote.unitPriceMinor >= 0 &&
        d(quote.moq).isFinite() && d(quote.moq).gte(0) && d(quote.multiple).isFinite() && d(quote.multiple).gt(0);
    } catch { /* Invalid quote stays non-actionable. */ }
    if (!validQuote) {
      facts.push(`${planLine.materialCode} 报价单价、起订量或数量倍数无效，不能比较`);
      continue;
    }
    const free = freeStock.toFixed(0);
    const inbound = timelyInbound.toFixed(0);
    const unitPriceYuan = d(quote.unitPriceMinor).div(100).toFixed(2);
    const optionA = option({
      gross: planLine.gross,
      free,
      inbound,
      usesFreeStock: true,
      usesTimelyInbound: true,
      moq: quote.moq,
      multiple: quote.multiple,
      unitPriceYuan,
      note: "使用可分配库存和及时在途",
    });
    const optionB = option({
      gross: planLine.gross,
      free,
      inbound,
      usesFreeStock: false,
      usesTimelyInbound: true,
      moq: quote.moq,
      multiple: quote.multiple,
      unitPriceYuan,
      alreadyReserved: ownOnHand.toFixed(0),
      note: "本单已收和及时在途照扣，历史余料不用",
    });
    const spendDifferenceYuan = d(optionB.amountYuan).minus(optionA.amountYuan).toFixed(2);
    lines.push({
      snapshot: sha256(JSON.stringify({ orderId, planLine, supplyNeedDate, quote, lots, ownAllocations: ownAllocations.filter(row => lots.some(lot => lot.id === row.lotId)) })),
      materialId: planLine.materialId,
      materialCode: planLine.materialCode,
      materialName: planLine.materialName,
      unit: planLine.unit,
      gross: planLine.gross,
      freeStock: free,
      timelyInbound: inbound,
      lateInbound: lateInbound.toFixed(0),
      optionA,
      optionB,
      spendDifferenceYuan,
      quoteVerified: true,
    });
    if (lateInbound.gt(0)) {
      facts.push(`${planLine.materialCode} 在途 ${lateInbound.toFixed(0)} ${planLine.unit} 晚于需求日，不得抵扣及时需求`);
    }
  }

  const draft = await client.purchaseDraft.findFirst({
    where: { orderId: order.id, organizationId },
    orderBy: { createdAt: "asc" },
  });
  if (draft?.status === "issued") {
    facts[0] = "规则计算。采购单已下达，未收料，未付款。差额不是利润。";
    facts.unshift(`方案 ${draft.optionCode} 已下达采购 ${draft.qty} 米，未收料，未付款`);
  } else {
    facts.unshift("未下达采购");
    if (draft?.status === "stale") facts.unshift(`方案需重算：供给或交期已变，旧采购草稿 ${draft.qty} 米已过期，未下达采购`);
    else if (draft) facts.unshift(`已采用方案 ${draft.optionCode}，采购草稿 ${draft.qty} 米，未下达采购`);
  }
  const next = leftoverNextStep({
    started: false,
    comparable: lines.length > 0,
    freeStock: lines[0]?.freeStock ?? "0",
    adopted: draft ? { optionCode: draft.optionCode, status: draft.status } : null,
  });
  if (next.kind === "ready") facts.unshift(next.label);
  return {
    orderId: order.id,
    orderNo: order.orderNo,
    supplyNeedDate,
    poIssued: draft?.status === "issued",
    mode: "rule_calculated",
    adopted: draft
      ? {
          optionCode: draft.optionCode,
          materialId: draft.materialId,
          qty: draft.qty,
          amountYuan: draft.amountYuan,
          allocatedFree: draft.allocatedFree,
          reservedInbound: draft.reservedInbound,
          status: draft.status,
          updatedAt: draft.updatedAt.toISOString(),
          issued: draft.status === "issued",
        }
      : null,
    lines,
    inboundLots,
    next,
    facts,
  };
}

export async function applyInboundEtaChange(input: {
  organizationId: string;
  userId: string;
  role: string;
  orderId: string;
  lotId: string;
  inboundEta: string;
  expectedEta: string;
}) {
  if (input.role !== "manager") throw new ExecutionError("无权核验在途日期");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.inboundEta)) throw new ExecutionError("在途日期必须是 YYYY-MM-DD");
  const order = await prisma.salesOrder.findFirst({
    where: { id: input.orderId, organizationId: input.organizationId },
  });
  if (!order) throw new ExecutionError("订单不存在或不属于当前组织");
  const lot = await prisma.inventoryLot.findFirst({
    where: { id: input.lotId, organizationId: input.organizationId },
  });
  if (!lot) throw new ExecutionError("库存批次不存在");
  if ((lot.inboundEta ?? "") !== input.expectedEta) {
    throw new ExecutionError("在途日期已被他人修改，请刷新后重试");
  }
  const updated = await prisma.$transaction(async (tx) => {
    const next = await tx.inventoryLot.update({
      where: { id: lot.id },
      data: { inboundEta: input.inboundEta, availableFrom: input.inboundEta },
    });
    const drafts = await tx.purchaseDraft.findMany({
      where: {
        organizationId: input.organizationId,
        materialId: lot.materialId,
        status: "draft",
      },
    });
    for (const draft of drafts) {
      await releaseOrderMaterialAllocations(tx, {
        organizationId: input.organizationId,
        orderId: draft.orderId,
        materialId: draft.materialId,
      });
      await tx.purchaseDraft.update({
        where: { id: draft.id },
        data: { status: "stale" },
      });
    }
    return { lot: next, staleCount: drafts.length };
  });
  await writeAudit({
    organizationId: input.organizationId,
    actorUserId: input.userId,
    action: "inbound.eta.verified",
    entityType: "InventoryLot",
    entityId: lot.id,
    summary:
      updated.staleCount > 0
        ? `核验在途 ${lot.inboundNo ?? lot.id} ETA ${input.expectedEta} → ${input.inboundEta}，采购草稿已过期，未下达采购`
        : `核验在途 ${lot.inboundNo ?? lot.id} ETA ${input.expectedEta} → ${input.inboundEta}，未下达采购`,
    payloadJson: JSON.stringify({
      orderId: order.id,
      actionType: ACTION_TYPES.issuePurchaseOrder,
      issued: false,
      staleDrafts: updated.staleCount,
    }),
  });
  return updated.lot;
}
