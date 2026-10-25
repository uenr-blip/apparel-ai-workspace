import { d } from "@/server/domain/procurement";

export type PackingLineInput = {
  colorName: string;
  sizeCode: string;
  quantity: number;
};

export type PackingWeightStatus = "pending" | "estimated" | "measured";

export type PackingCartonInput = {
  cartonNo: string;
  lines: PackingLineInput[];
  netWeight?: string | null;
  grossWeight?: string | null;
  weightStatus?: PackingWeightStatus;
};

export type PackingCartonSummary = {
  cartonNo: string;
  qty: number;
  colors: string[];
  sizeCodes: string[];
  weightStatus: PackingWeightStatus;
  netWeight: string | null;
  grossWeight: string | null;
  lines: PackingLineInput[];
};

export type PackingPlanSummary = {
  total: number;
  cartons: PackingCartonSummary[];
  colors: string[];
  sizeCodes: string[];
};

export function weightStatusFor(input: {
  netWeight?: string | null;
  grossWeight?: string | null;
  claimed?: PackingWeightStatus;
}): PackingWeightStatus {
  const net = input.netWeight?.trim() || "";
  const gross = input.grossWeight?.trim() || "";
  if (input.claimed === "measured") {
    return net && gross ? "measured" : "pending";
  }
  if (net || gross) return "estimated";
  return "pending";
}

export function parseWeightKg(value: string | null | undefined): string | null {
  const raw = value?.trim() || "";
  if (!raw) return null;
  try {
    const parsed = d(raw);
    if (!parsed.isFinite() || parsed.lt(0)) throw new Error("bad");
    return parsed.toFixed(2);
  } catch {
    throw new Error("重量必须是非负数字");
  }
}

export function availableFinishedGoods(input: { good: number; shipped: number; occupied: number }) {
  return input.good - input.shipped - input.occupied;
}

export function summarizePackingPlan(cartons: PackingCartonInput[]): PackingPlanSummary {
  if (!cartons.length) throw new Error("至少一箱");
  const seen = new Set<string>();
  const resultCartons = cartons.map((carton) => {
    const cartonNo = carton.cartonNo.trim();
    if (!cartonNo) throw new Error("箱号不能为空");
    if (seen.has(cartonNo)) throw new Error("箱号重复");
    seen.add(cartonNo);
    if (!carton.lines.length) throw new Error(`${cartonNo} 缺少明细`);
    const lineKeys = new Set<string>();
    let qty = 0;
    const lines = carton.lines.map((line) => {
      const colorName = line.colorName.trim();
      const sizeCode = line.sizeCode.trim();
      if (!colorName) throw new Error("颜色不能为空");
      if (!Number.isInteger(line.quantity) || line.quantity <= 0) throw new Error("件数必须是正整数");
      const key = `${colorName}::${sizeCode}`;
      if (lineKeys.has(key)) throw new Error("同箱颜色尺码重复");
      lineKeys.add(key);
      qty += line.quantity;
      return { colorName, sizeCode, quantity: line.quantity };
    });
    return {
      cartonNo,
      qty,
      colors: unique(lines.map((item) => item.colorName)),
      sizeCodes: unique(lines.map((item) => item.sizeCode).filter(Boolean)),
      weightStatus: weightStatusFor(carton),
      netWeight: carton.netWeight?.trim() || null,
      grossWeight: carton.grossWeight?.trim() || null,
      lines,
    };
  });
  return {
    total: resultCartons.reduce((sum, carton) => sum + carton.qty, 0),
    cartons: resultCartons,
    colors: unique(resultCartons.flatMap((carton) => carton.colors)),
    sizeCodes: unique(resultCartons.flatMap((carton) => carton.sizeCodes)),
  };
}

function unique(values: string[]) {
  return [...new Set(values)];
}
