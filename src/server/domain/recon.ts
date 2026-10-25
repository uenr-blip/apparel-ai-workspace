import { d } from "@/server/domain/procurement";

export type ReconDraftComputation = {
  status: "draft" | "needs_basis";
  shippedQty: number;
  unitPriceYuan: string | null;
  amountYuan: string | null;
  paid: false;
  basisNote: string;
};

export function computeReconDraft(input: {
  shippedQty: number;
  unitPriceYuan: string | null;
  basisNote: string;
  adjustmentsYuan?: string;
}): ReconDraftComputation {
  const shippedQty = input.shippedQty;
  if (!Number.isInteger(shippedQty) || shippedQty < 0) {
    throw new Error("出运件数无效");
  }
  const price = input.unitPriceYuan?.trim() || "";
  if (!price) {
    return {
      status: "needs_basis",
      shippedQty,
      unitPriceYuan: null,
      amountYuan: null,
      paid: false,
      basisNote: input.basisNote.includes("待核实") ? input.basisNote : `${input.basisNote} 待核实`,
    };
  }
  try {
    const unit = d(price);
    if (!unit.isFinite() || unit.lte(0) || unit.decimalPlaces() > 6) throw new Error("bad");
    const adjust = d(input.adjustmentsYuan || "0");
    if (!adjust.isFinite()) throw new Error("bad");
    const amountYuan = unit.mul(shippedQty).plus(adjust).toFixed(2);
    return {
      status: "draft",
      shippedQty,
      unitPriceYuan: unit.toFixed(Math.max(2, unit.decimalPlaces())),
      amountYuan,
      paid: false,
      basisNote: input.basisNote,
    };
  } catch {
    return {
      status: "needs_basis",
      shippedQty,
      unitPriceYuan: null,
      amountYuan: null,
      paid: false,
      basisNote: "计价基准无效，待核实",
    };
  }
}
