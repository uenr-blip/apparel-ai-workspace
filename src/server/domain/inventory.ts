import { d } from "@/server/domain/procurement";

export function inventoryDate() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: process.env.DEMO_TIMEZONE || "Asia/Shanghai" }).format(new Date());
}

export function inventoryAvailability(lot: {
  qtyOnHand: string; qtyAllocated: string; qtyInbound: string;
  ownerKind: string; qualityStatus: string; availableFrom: string; inboundEta: string | null;
}) {
  const reasons: string[] = [];
  let free = d(0);
  try {
    const hand = d(lot.qtyOnHand), allocated = d(lot.qtyAllocated), inbound = d(lot.qtyInbound);
    if (![hand, allocated, inbound].every(value => value.isFinite() && value.gte(0)) ||
        allocated.gt(lot.inboundEta ? inbound : hand)) reasons.push("账面数量需核对");
    free = hand.minus(allocated);
  } catch { reasons.push("账面数量需核对"); }
  if (lot.inboundEta) reasons.push("在途尚未收货");
  if (lot.ownerKind !== "company") reasons.push("非公司所有");
  if (lot.qualityStatus !== "qualified") reasons.push("质检未放行");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(lot.availableFrom) || Number.isNaN(Date.parse(lot.availableFrom))) reasons.push("可用日期需核对");
  else if (lot.availableFrom > inventoryDate()) reasons.push("尚未到可用日期");
  if (free.lte(0) && !reasons.length) reasons.push("已占用或已用完");
  const availableQty = reasons.length || free.lte(0) ? "0" : free.toFixed();
  return { availableQty, unavailableReasons: reasons, canMove: !reasons.length && free.gt(0) };
}
