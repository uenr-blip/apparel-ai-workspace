export const CRAFT_FAMILIES = ["sweater", "knit", "woven"] as const;
export type CraftFamily = (typeof CRAFT_FAMILIES)[number];

export const CRAFT_LABEL: Record<CraftFamily, string> = {
  sweater: "毛衣",
  knit: "针织",
  woven: "梭织",
};

export const PATTERN_ORIGINS = ["copy_garment", "online_style", "from_material", "other"] as const;
export type PatternOrigin = (typeof PATTERN_ORIGINS)[number];

export const PATTERN_ORIGIN_LABEL: Record<PatternOrigin, string> = {
  copy_garment: "客人拿衣服来抄",
  online_style: "网上选的款，再配料",
  from_material: "先看中料，再做款",
  other: "其他",
};

export type StockMark = "" | "yes" | "no" | "unknown";

export type SweaterSheet = {
  imagePath: string;
  imageNote: string;
  yarnComposition: string;
  yarnCount: string;
  bodyStructure: string;
  needleType: string;
  yarnSupplier: string;
  yarnPrice: string;
  inStock: StockMark;
  customYarnPrice: string;
};

export type FabricSheet = {
  imagePath: string;
  imageNote: string;
  fabricComposition: string;
  gsm: string;
  spec: string;
  width: string;
  supplier: string;
  price: string;
  inStock: StockMark;
  orderQtyPrice: string;
  lining: string;
  trims: string;
};

export type PatternDraft = {
  origin: PatternOrigin | "";
  originNote: string;
  craftFamily: CraftFamily;
  sweater: SweaterSheet;
  fabric: FabricSheet;
};

const TEXT = 400;

export function craftLabel(value: string) {
  if (value === "sweater" || value === "knit" || value === "woven") return CRAFT_LABEL[value];
  return "";
}

export function emptySweater(): SweaterSheet {
  return {
    imagePath: "",
    imageNote: "",
    yarnComposition: "",
    yarnCount: "",
    bodyStructure: "",
    needleType: "",
    yarnSupplier: "",
    yarnPrice: "",
    inStock: "",
    customYarnPrice: "",
  };
}

export function emptyFabric(): FabricSheet {
  return {
    imagePath: "",
    imageNote: "",
    fabricComposition: "",
    gsm: "",
    spec: "",
    width: "",
    supplier: "",
    price: "",
    inStock: "",
    orderQtyPrice: "",
    lining: "",
    trims: "",
  };
}

function clip(value: unknown, max = TEXT) {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, max);
}

function stock(value: unknown): StockMark {
  if (value === "yes" || value === "no" || value === "unknown") return value;
  return "";
}

function originOf(value: unknown): PatternOrigin | "" {
  if (value === "copy_garment" || value === "online_style" || value === "from_material" || value === "other") return value;
  return "";
}

function readObject(json: string) {
  try {
    const parsed = JSON.parse(json) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as Record<string, unknown>;
  } catch {
    return {};
  }
}

export function readPatternSheet(craftFamily: string, sheetJson: string): {
  origin: PatternOrigin | "";
  originNote: string;
  craftFamily: CraftFamily | "";
  sweater: SweaterSheet;
  fabric: FabricSheet;
} {
  const raw = readObject(sheetJson);
  const sweaterRaw = raw.sweater && typeof raw.sweater === "object" ? (raw.sweater as Record<string, unknown>) : {};
  const fabricRaw = raw.fabric && typeof raw.fabric === "object" ? (raw.fabric as Record<string, unknown>) : {};
  return {
    origin: originOf(raw.origin),
    originNote: clip(raw.originNote),
    craftFamily: craftFamily === "sweater" || craftFamily === "knit" || craftFamily === "woven" ? craftFamily : "",
    sweater: {
      imagePath: clip(sweaterRaw.imagePath),
      imageNote: clip(sweaterRaw.imageNote),
      yarnComposition: clip(sweaterRaw.yarnComposition),
      yarnCount: clip(sweaterRaw.yarnCount),
      bodyStructure: clip(sweaterRaw.bodyStructure),
      needleType: clip(sweaterRaw.needleType),
      yarnSupplier: clip(sweaterRaw.yarnSupplier),
      yarnPrice: clip(sweaterRaw.yarnPrice),
      inStock: stock(sweaterRaw.inStock),
      customYarnPrice: clip(sweaterRaw.customYarnPrice),
    },
    fabric: {
      imagePath: clip(fabricRaw.imagePath),
      imageNote: clip(fabricRaw.imageNote),
      fabricComposition: clip(fabricRaw.fabricComposition),
      gsm: clip(fabricRaw.gsm),
      spec: clip(fabricRaw.spec),
      width: clip(fabricRaw.width),
      supplier: clip(fabricRaw.supplier),
      price: clip(fabricRaw.price),
      inStock: stock(fabricRaw.inStock),
      orderQtyPrice: clip(fabricRaw.orderQtyPrice),
      lining: clip(fabricRaw.lining),
      trims: clip(fabricRaw.trims),
    },
  };
}

export function normalizePatternSheet(input: {
  origin?: unknown;
  originNote?: unknown;
  craftFamily?: unknown;
  sweater?: unknown;
  fabric?: unknown;
}) {
  const craftFamily = input.craftFamily;
  if (craftFamily !== "sweater" && craftFamily !== "knit" && craftFamily !== "woven") {
    throw new Error("请先选毛衣、针织或梭织");
  }
  const current = readPatternSheet(craftFamily, JSON.stringify({
    origin: input.origin,
    originNote: input.originNote,
    sweater: input.sweater,
    fabric: input.fabric,
  }));
  const sheetJson = JSON.stringify({
    origin: current.origin,
    originNote: current.originNote,
    sweater: current.sweater,
    fabric: current.fabric,
  });
  return { craftFamily, origin: current.origin, originNote: current.originNote, sweater: current.sweater, fabric: current.fabric, sheetJson };
}
