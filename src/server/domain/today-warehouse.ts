import { d } from "@/server/domain/procurement";
import type { LeftoverNext } from "@/server/domain/leftover-next";

export type TodaySupplyLine = {
  materialId: string;
  materialCode: string;
  materialName: string;
  unit: string;
  remaining: string | null;
  companyOnHand: string;
  atFactory: string;
  blocker: string | null;
};

export type TodaySupply = {
  orderId: string;
  orderNo: string;
  factoryName: string;
  started: boolean;
  leftover: LeftoverNext;
  lines: TodaySupplyLine[];
};

export type TodayInboundLot = {
  id: string;
  materialId: string;
  materialCode: string;
  materialName: string;
  colorName: string;
  qtyInbound: string;
  inboundEta: string | null;
  locationName: string;
  orderNos: string[];
};

export function todayTransferJobs(supplies: TodaySupply[]) {
  return supplies.flatMap((supply) => {
    if (supply.started) return [];
    return supply.lines
      .filter((line) => line.blocker === "未调到厂")
      .map((line) => ({
        kind: "transfer" as const,
        orderId: supply.orderId,
        orderNo: supply.orderNo,
        factoryName: supply.factoryName,
        materialId: line.materialId,
        materialCode: line.materialCode,
        materialName: line.materialName,
        unit: line.unit,
        remaining: line.remaining ?? "0",
        atFactory: line.atFactory,
        action: "调到厂",
        href: `/orders/${supply.orderId}#material-supply`,
      }));
  });
}

export function todayLeftoverJobs(supplies: TodaySupply[]) {
  return supplies.flatMap((supply) => {
    if (supply.started) return [];
    if (supply.leftover.recommend !== "A") return [];
    if (supply.leftover.kind !== "ready" && supply.leftover.kind !== "stale") return [];
    return [
      {
        kind: "leftover" as const,
        orderId: supply.orderId,
        orderNo: supply.orderNo,
        factoryName: supply.factoryName,
        label: supply.leftover.label,
        recommend: "A" as const,
        href: `/orders/${supply.orderId}#material-supply`,
      },
    ];
  });
}

export function todayInboundJobs(lots: TodayInboundLot[]) {
  return lots
    .filter((lot) => lot.inboundEta && d(lot.qtyInbound).gt(0))
    .map((lot) => ({
      kind: "inbound" as const,
      lotId: lot.id,
      materialId: lot.materialId,
      materialCode: lot.materialCode,
      materialName: lot.materialName,
      colorName: lot.colorName,
      qtyInbound: lot.qtyInbound,
      eta: lot.inboundEta as string,
      locationName: lot.locationName,
      orderNos: lot.orderNos,
      href: `/resources/lots/${lot.id}`,
    }));
}
