export type ProductionKind = "started" | "scrapped" | "wip" | "good" | "shipped" | "rework";

export type ProductionRecord = {
  kind: string;
  quantity: number;
};

export type ProductionSummary = {
  started: number;
  scrapped: number;
  wip: number;
  good: number;
  shipped: number;
  leftover: number;
  rework: number;
  incorrectScrapInference: number;
  stage: "not_started" | "in_progress" | "leftover_unshipped" | "shipped";
};

export function summarizeProduction(records: ProductionRecord[]): ProductionSummary {
  const startedHere = sumKind(records, "started");
  const transferIn = sumKind(records, "transfer_in"), transferOut = sumKind(records, "transfer_out");
  const started = startedHere + transferIn - transferOut;
  const scrapped = sumKind(records, "scrapped");
  const reportedWip = sumKind(records, "wip");
  const good = sumKind(records, "good");
  const wip = transferIn || transferOut ? Math.max(0, started - good - scrapped) : reportedWip;
  const shipped = sumKind(records, "shipped");
  const leftover = good - shipped;
  const rework = sumKind(records, "rework");
  const incorrectScrapInference = started - shipped;
  let stage: ProductionSummary["stage"] = "not_started";
  if (started > 0 || good > 0 || shipped > 0) {
    if (good > 0 && leftover === 0 && shipped > 0) stage = "shipped";
    else if (leftover > 0) stage = "leftover_unshipped";
    else stage = "in_progress";
  }
  return {
    started,
    scrapped,
    wip,
    good,
    shipped,
    leftover,
    rework,
    incorrectScrapInference,
    stage,
  };
}

function sumKind(records: ProductionRecord[], kind: string) {
  return records.filter((row) => row.kind === kind).reduce((sum, row) => sum + row.quantity, 0);
}

export type ProductionColorSizeLine = {
  colorName: string;
  sizeCode: string;
  quantity: number;
};

export type OrderColorSizeCatalog = {
  colors: Array<{ colorName: string; sizes: Array<{ sizeCode: string }> }>;
};

export function collectProductionLines(
  lines: Array<{ colorName: string; sizeCode?: string; quantity: number }> | undefined,
): { lines: ProductionColorSizeLine[]; quantity: number } | null {
  if (!lines?.length) return null;
  const cleaned: ProductionColorSizeLine[] = [];
  for (const line of lines) {
    const colorName = line.colorName.trim();
    const sizeCode = (line.sizeCode ?? "").trim();
    if (!colorName) continue;
    if (!Number.isInteger(line.quantity) || line.quantity <= 0) {
      throw new Error("色尺件数必须是正整数");
    }
    cleaned.push({ colorName, sizeCode, quantity: line.quantity });
  }
  if (!cleaned.length) return null;
  return {
    lines: cleaned,
    quantity: cleaned.reduce((sum, line) => sum + line.quantity, 0),
  };
}

export function assertLinesMatchOrder(lines: ProductionColorSizeLine[], catalog: OrderColorSizeCatalog) {
  const colors = new Map(catalog.colors.map((color) => [color.colorName, new Set(color.sizes.map((size) => size.sizeCode))]));
  if (colors.size === 0) {
    throw new Error("本单还没有色尺，不能按色尺登记");
  }
  for (const line of lines) {
    const sizes = colors.get(line.colorName);
    if (!sizes) throw new Error("颜色不在本单色尺里，请先在订单页加色");
    if (sizes.size > 0 && !line.sizeCode) throw new Error("本单已拆尺码，请按色尺填写");
    if (sizes.size > 0 && !sizes.has(line.sizeCode)) throw new Error("尺码不在本单色尺里");
    if (sizes.size === 0 && line.sizeCode) throw new Error("本单尚未拆尺码，不要填尺码");
  }
}
