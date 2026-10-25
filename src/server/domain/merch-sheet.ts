import { quantityMilli, quantityText } from "@/lib/material-quantity";
import type { StoredConstructionItem } from "@/lib/style-construction";
import { craftLabel, type CraftFamily } from "@/server/domain/craft-sheet";

export type SampleElement = { id: string; label: string; text: string; images: string[] };
export const MAX_SAMPLE_ELEMENTS = 24;

export type SalesSample = {
  factoryName: string;
  colorOpinion: string;
  po: string;
  numericCode: string;
  gsm: string;
  composition: string;
  colors: string;
  shellWidth: string;
  shellConsumption: string;
  shellPrice: string;
  liningWidth: string;
  liningConsumption: string;
  liningPrice: string;
  buttonPrice: string;
  laborPrice: string;
  otherTrimCost: string;
  totalPrice: string;
  photoSample: string;
  salesSample: string;
  metalBadge: string;
  liningColor: string;
  mainLabel: string;
  hangtag: string;
  sticker: string;
  note: string;
  progress: string;
  fabricProgress: string;
  buttonProgress: string;
  zipperProgress: string;
  pictures: CellPictures;
  elements?: SampleElement[];
};

export const CELL_PICTURE_KEYS = ["metalBadge", "liningColor", "mainLabel", "hangtag", "note"] as const;

export type CellPictureKey = (typeof CELL_PICTURE_KEYS)[number];

export type CellPictures = Record<CellPictureKey, string[]>;

export const MAX_CELL_PICTURES = 6;

export function emptyCellPictures(): CellPictures {
  return { metalBadge: [], liningColor: [], mainLabel: [], hangtag: [], note: [] };
}

export function readCellPictures(value: unknown): CellPictures {
  const next = emptyCellPictures();
  if (!value || typeof value !== "object" || Array.isArray(value)) return next;
  const raw = value as Record<string, unknown>;
  for (const key of CELL_PICTURE_KEYS) {
    const list = Array.isArray(raw[key]) ? raw[key] : [];
    next[key] = list.map((item) => sheetImagePath(item)).filter(Boolean).slice(0, MAX_CELL_PICTURES);
  }
  return next;
}

export const COLOR_TRIM_FIELDS = {
  mainLabel: "主唛", careSizeLabel: "洗唛 / 尺码唛", instructionLabel: "说明唛",
  spareLabel: "备扣空白唛", hangtag: "吊牌", patch: "贴布 / 毛毡",
  embroidery: "绣花 / 印花", bartack: "套结色", otherTrim: "每色其他辅料",
  careLabel: "洗唛", sizeLabel: "尺码唛", specialProcess: "特殊工艺",
} as const;
export type ColorTrimKey = keyof typeof COLOR_TRIM_FIELDS;
export const BULK_LABEL_KEYS = ["careLabel", "sizeLabel", "instructionLabel", "spareLabel", "hangtag"] as const;
export const BULK_PROCESS_KEYS = ["specialProcess", "otherTrim"] as const;
export const BULK_PICTURE_KEYS = ["mainLabel", "button", "zipper", "hook", "otherTrim"] as const;
export const COLOR_PICTURE_KEYS = [...BULK_LABEL_KEYS, ...BULK_PROCESS_KEYS, "metalBadge"] as const;
export type BulkPictureKey = (typeof BULK_PICTURE_KEYS)[number];
export type ColorPictureKey = (typeof COLOR_PICTURE_KEYS)[number];
export type BulkPictures = Partial<Record<BulkPictureKey, string[]>>;
export type ColorPictures = Partial<Record<ColorPictureKey, string[]>>;
export const LABEL_COLOR_KEYS = ["careLabel", "sizeLabel", "instructionLabel", "spareLabel"] as const;
export type LabelColorKey = (typeof LABEL_COLOR_KEYS)[number];
export const SAME_AS_CARE = "__same_as_care__";

export type BulkColor = {
  guestColor: string;
  factoryColorName: string;
  qtyText: string;
  metalBadge: string;
  colorTrims?: Partial<Record<ColorTrimKey, string>>;
  labelColors?: Partial<Record<LabelColorKey, string>>;
  pictures?: ColorPictures;
};

export type BulkSheet = {
  mainLabel?: string;
  pictures?: BulkPictures;
  orderNo: string;
  po: string;
  purchaseDate: string;
  composition: string;
  inboundDate: string;
  shipDate: string;
  progress: string;
  fabricProgress: string;
  buttonProgress: string;
  zipperProgress: string;
  button: string;
  zipper: string;
  hook: string;
  metalBadge: string;
  otherTrim: string;
  colors: BulkColor[];
};

/** Shared within this product/PO only. Legacy differences remain visible until a person resolves them. */
export function bulkMainLabel(sheet: { mainLabel?: string; colors: BulkColor[] }) {
  if (typeof sheet.mainLabel === "string") return sheet.mainLabel;
  const entries = sheet.colors.map((c, i) => ({ color: c.guestColor || `${i + 1} 行`, text: c.colorTrims?.mainLabel?.trim() || "" }));
  const texts = [...new Set(entries.map(c => c.text).filter(Boolean))];
  if (!texts.length) return "";
  if (texts.length === 1 && entries.every(c => c.text)) return texts[0];
  return entries.map(c => `${c.color}：${c.text || "待补"}`).join("\n");
}

export function specialProcessText(color: BulkColor) {
  if (typeof color.colorTrims?.specialProcess === "string") return color.colorTrims.specialProcess;
  return (["patch", "embroidery", "bartack"] as const).flatMap(key => color.colorTrims?.[key] ? [`${COLOR_TRIM_FIELDS[key]}：${color.colorTrims[key]}`] : []).join("\n");
}

export function labelColorText(color: BulkColor, key: LabelColorKey) {
  const value = color.labelColors?.[key] || "";
  if (value !== SAME_AS_CARE) return value;
  const care = color.labelColors?.careLabel;
  return `同洗唛（${care && care !== SAME_AS_CARE ? care : "洗唛颜色待选"}）`;
}

export function colorTrimText(color: BulkColor, key: ColorTrimKey) {
  if (key === "specialProcess") return specialProcessText(color);
  const text = color.colorTrims?.[key] || "";
  if (LABEL_COLOR_KEYS.includes(key as LabelColorKey)) return [labelColorText(color, key as LabelColorKey), text].filter(Boolean).join(" · ");
  return text;
}

export type PurchaseLine = {
  name: string;
  consumption: string;
  price: string;
  buyQty: string;
  note: string;
};

export type SeasonSource = {
  construction?: StoredConstructionItem[];
  kind?: string;
  orderId: string;
  orderNo: string;
  href?: string;
  styleCode: string;
  styleName: string;
  imagePath: string;
  factoryName: string;
  seasonCode: string;
  craftFamily: string;
  salesSample: SalesSample;
  bulk: BulkSheet;
};

export type SeasonRow = {
  orderId: string;
  orderNo: string;
  href: string;
  styleCode: string;
  styleName: string;
  imagePath: string;
  composition: string;
  colorQty: string;
  delivery: string;
  trims: string;
  progress: string;
  factoryName: string;
  seasonCode: string;
  craftLabel: string;
};

export type SeasonBoard = {
  counts: { sweater: number; knit: number; woven: number; unset: number };
  factories: Array<{ name: string; styles: string[] }>;
  rows: SeasonRow[];
  purchases: Array<PurchaseLine & { styleCode: string; orderNo: string }>;
};

const TEXT = 400;
const LONG = 800;
const MAX_COLORS = 40;

export function emptySalesSample(): SalesSample {
  return {
    factoryName: "",
    colorOpinion: "",
    po: "",
    numericCode: "",
    gsm: "",
    composition: "",
    colors: "",
    shellWidth: "",
    shellConsumption: "",
    shellPrice: "",
    liningWidth: "",
    liningConsumption: "",
    liningPrice: "",
    buttonPrice: "",
    laborPrice: "",
    otherTrimCost: "",
    totalPrice: "",
    photoSample: "",
    salesSample: "",
    metalBadge: "",
    liningColor: "",
    mainLabel: "",
    hangtag: "",
    sticker: "",
    note: "",
    progress: "",
    fabricProgress: "",
    buttonProgress: "",
    zipperProgress: "",
    pictures: emptyCellPictures(),
  };
}

export function emptyBulk(): BulkSheet {
  return {
    orderNo: "",
    po: "",
    purchaseDate: "",
    composition: "",
    inboundDate: "",
    shipDate: "",
    progress: "",
    fabricProgress: "",
    buttonProgress: "",
    zipperProgress: "",
    button: "",
    zipper: "",
    hook: "",
    metalBadge: "",
    otherTrim: "",
    colors: [],
  };
}

function clip(value: unknown, max = TEXT) {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, max);
}

export function sheetImagePath(value: unknown) {
  const text = clip(value, 120);
  return /^\/api\/sheet-images\/[\w-]{8,80}$/.test(text) ? text : "";
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

export function readSalesSample(json: string): SalesSample {
  const raw = readObject(json);
  const empty = emptySalesSample();
  const next: SalesSample = { ...empty, pictures: readCellPictures(raw.pictures) };
  if (Array.isArray(raw.elements)) next.elements = raw.elements.map((value, index) => {
    const row = value && typeof value === "object" ? value as Record<string, unknown> : {};
    return { id: clip(row.id, 80) || `legacy-${index}`, label: clip(row.label, 80), text: clip(row.text, LONG), images: (Array.isArray(row.images) ? row.images : []).map(sheetImagePath).filter(Boolean).slice(0, MAX_CELL_PICTURES) };
  }).slice(0, MAX_SAMPLE_ELEMENTS);
  (Object.keys(empty) as Array<keyof SalesSample>).forEach((key) => {
    if (key === "pictures" || key === "elements") return;
    const max = key === "colorOpinion" || key === "note" || key === "progress" || key === "fabricProgress" || key === "buttonProgress" || key === "zipperProgress" ? LONG : TEXT;
    next[key] = clip(raw[key], max);
  });
  return next;
}

function readFieldPictures<K extends string>(value: unknown, keys: readonly K[]): Partial<Record<K, string[]>> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  return Object.fromEntries(keys.flatMap(key => Array.isArray(raw[key])
    ? [[key, [...new Set(raw[key].map(sheetImagePath).filter(Boolean))].slice(0, MAX_CELL_PICTURES)]] : [])) as Partial<Record<K, string[]>>;
}

function validateFieldPictures(value: unknown, keys: readonly string[]) {
  if (value === undefined) return;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("图片资料格式无效，请重新选择");
  for (const [key, images] of Object.entries(value)) {
    if (!keys.includes(key) || !Array.isArray(images) || images.length > MAX_CELL_PICTURES || images.some(image => !sheetImagePath(image))) {
      throw new Error("每项最多 6 张 JPG 或 PNG 图片，请重新选择");
    }
  }
}

export function readBulk(json: string): BulkSheet {
  const raw = readObject(json);
  const colors = Array.isArray(raw.colors) ? raw.colors : [];
  return {
    ...(typeof raw.mainLabel === "string" ? { mainLabel: clip(raw.mainLabel, LONG) } : {}),
    ...(raw.pictures !== undefined ? { pictures: readFieldPictures(raw.pictures, BULK_PICTURE_KEYS) } : {}),
    orderNo: clip(raw.orderNo),
    po: clip(raw.po),
    purchaseDate: clip(raw.purchaseDate, 80),
    composition: clip(raw.composition),
    inboundDate: clip(raw.inboundDate, 80),
    shipDate: clip(raw.shipDate, 80),
    progress: clip(raw.progress, LONG),
    fabricProgress: clip(raw.fabricProgress, LONG),
    buttonProgress: clip(raw.buttonProgress, LONG),
    zipperProgress: clip(raw.zipperProgress, LONG),
    button: clip(raw.button, LONG),
    zipper: clip(raw.zipper, LONG),
    hook: clip(raw.hook, LONG),
    metalBadge: clip(raw.metalBadge, LONG),
    otherTrim: clip(raw.otherTrim, LONG),
    colors: colors
      .map((row) => {
        const item = row && typeof row === "object" ? (row as Record<string, unknown>) : {};
        return {
          guestColor: clip(item.guestColor, 80),
          factoryColorName: clip(item.factoryColorName, 80),
          qtyText: clip(item.qtyText, 40),
          metalBadge: clip(item.metalBadge, LONG),
          ...(item.pictures !== undefined ? { pictures: readFieldPictures(item.pictures, COLOR_PICTURE_KEYS) } : {}),
          colorTrims: Object.fromEntries(Object.keys(COLOR_TRIM_FIELDS).flatMap(key => {
            const raw = item.colorTrims && typeof item.colorTrims === "object" ? (item.colorTrims as Record<string, unknown>)[key] : undefined;
            return typeof raw === "string" ? [[key, clip(raw, key === "specialProcess" ? 3000 : LONG)]] : [];
          })),
          ...(item.labelColors && typeof item.labelColors === "object" ? { labelColors: Object.fromEntries(LABEL_COLOR_KEYS.flatMap(key => {
            const value = clip((item.labelColors as Record<string, unknown>)[key], 80);
            return value ? [[key, value]] : [];
          })) } : {}),
        };
      })
      .filter((row) => row.guestColor || row.factoryColorName || row.qtyText || row.metalBadge || Object.values(row.colorTrims ?? {}).some(Boolean) || Object.values(row.labelColors ?? {}).some(Boolean) || Object.values(row.pictures ?? {}).some(images => images?.length))
      .slice(0, MAX_COLORS),
  };
}

export function normalizeMerchSheet(input: {
  seasonCode?: unknown;
  craftFamily?: unknown;
  salesSample?: unknown;
  bulk?: unknown;
}) {
  const craft = input.craftFamily;
  if (craft !== "" && craft !== "sweater" && craft !== "knit" && craft !== "woven") {
    throw new Error("工艺请选毛衣、针织或梭织");
  }
  const rawSample = input.salesSample as Partial<SalesSample> | undefined;
  if (rawSample?.elements !== undefined) {
    if (!Array.isArray(rawSample.elements) || rawSample.elements.length > MAX_SAMPLE_ELEMENTS) throw new Error(`每款最多添加 ${MAX_SAMPLE_ELEMENTS} 个元素`);
    const ids = new Set<string>();
    for (const element of rawSample.elements) {
      if (!element || !clip(element.label, 80)) throw new Error("请先填写新增元素的名称");
      if (!clip(element.id, 80) || ids.has(element.id)) throw new Error("元素标记重复或缺失，请重新添加");
      ids.add(element.id);
      if (element.label.length > 80 || (element.text?.length ?? 0) > LONG) throw new Error("元素名称或说明过长，请精简后保存");
      if (!Array.isArray(element.images) || element.images.length > MAX_CELL_PICTURES || element.images.some(image => !sheetImagePath(image))) throw new Error("元素图片无效或超过 6 张，请重新选择");
    }
  }
  const rawBulk = input.bulk as Partial<BulkSheet> | undefined;
  validateFieldPictures(rawBulk?.pictures, BULK_PICTURE_KEYS);
  if (Array.isArray(rawBulk?.colors)) for (const color of rawBulk.colors) validateFieldPictures(color?.pictures, COLOR_PICTURE_KEYS);
  const salesSample = readSalesSample(JSON.stringify(input.salesSample ?? {}));
  const bulk = readBulk(JSON.stringify(input.bulk ?? {}));
  for (const color of bulk.colors) for (const key of ["careLabel", "sizeLabel"] as const) {
    if (color.labelColors?.[key] === SAME_AS_CARE) throw new Error("洗唛和尺码唛请独立选择颜色");
  }
  const incomingColors = input.bulk && typeof input.bulk === "object" && Array.isArray((input.bulk as { colors?: unknown }).colors)
    ? (input.bulk as { colors: unknown[] }).colors.length
    : 0;
  if (incomingColors > MAX_COLORS) throw new Error("一个款的颜色行太多");
  return {
    seasonCode: clip(input.seasonCode, 40),
    craftFamily: craft as CraftFamily | "",
    salesSample,
    bulk,
    salesSampleJson: JSON.stringify(salesSample),
    bulkJson: JSON.stringify(bulk),
  };
}

export function bulkPieceCount(bulk: BulkSheet) {
  let count = 0;
  let anyNumber = false;
  let dropped = false;
  let unreadable = false;
  for (const row of bulk.colors) {
    const text = row.qtyText.trim();
    if (!text) {
      unreadable = true;
      continue;
    }
    if (text === "不下") {
      dropped = true;
      continue;
    }
    if (/^\d{1,7}$/.test(text)) {
      count += Number(text);
      anyNumber = true;
      continue;
    }
    unreadable = true;
  }
  if (!bulk.colors.length) return { count: null as number | null, dropped, unreadable };
  if (!anyNumber && dropped && !unreadable) return { count: 0, dropped, unreadable };
  if (!anyNumber) return { count: null, dropped, unreadable };
  return { count, dropped, unreadable };
}

export function orderColorPieces(style: { salesSample: SalesSample; bulk: BulkSheet }, kind: string) {
  if (kind === "sales_sample") {
    const pieces = leadingInt(style.salesSample.salesSample);
    return pieces ? [{ colorName: style.salesSample.colors.trim() || "销售样", quantity: pieces }] : [];
  }
  const rows: Array<{ colorName: string; quantity: number }> = [];
  for (const color of style.bulk.colors) {
    const text = color.qtyText.trim();
    if (text === "不下" || text === "0") continue;
    if (!/^\d{1,7}$/.test(text) || !color.guestColor.trim()) return [];
    rows.push({ colorName: color.guestColor.trim(), quantity: Number(text) });
  }
  const merged = new Map<string, number>();
  for (const row of rows) merged.set(row.colorName, (merged.get(row.colorName) ?? 0) + row.quantity);
  return [...merged].map(([colorName, quantity]) => ({ colorName, quantity }));
}

function leadingInt(text: string) {
  const matched = /^\s*(\d{1,7})\b/.exec(text);
  return matched ? Number(matched[1]) : null;
}

export function scaleConsumption(consumption: string, pieces: number | null) {
  if (pieces === null) return "";
  const raw = consumption.trim();
  if (!raw || !/^\d{1,7}(\.\d{1,3})?$/.test(raw)) return "";
  if (pieces === 0) return "0";
  try {
    return quantityText(quantityMilli(raw) * BigInt(pieces));
  } catch {
    return "";
  }
}

function pieceBasis(sample: SalesSample, bulk: BulkSheet, kind: string) {
  if (kind === "sales_sample") {
    const pieces = leadingInt(sample.salesSample);
    return { pieces, basis: pieces === null ? "none" : "sample", dropped: 0, unreadable: 0 };
  }
  const result = bulkPieceCount(bulk);
  return { pieces: result.unreadable ? null : result.count, basis: "bulk", ...result };
}

export function purchaseLines(sample: SalesSample, bulk: BulkSheet, kind = "bulk"): PurchaseLine[] {
  const basis = pieceBasis(sample, bulk, kind);
  const lines: PurchaseLine[] = [];
  function add(name: string, consumption: string, price: string) {
    const usedName = name.trim();
    const usedConsumption = consumption.trim();
    const usedPrice = price.trim();
    if (!usedName || (!usedConsumption && !usedPrice)) return;
    const buyQty = scaleConsumption(usedConsumption, basis.pieces);
    const notes: string[] = [];
    if (basis.basis === "sample") notes.push("按本销售样跟单件数计算");
    if (basis.pieces === null && usedConsumption) notes.push("件数还不是数字，要买数量先空着");
    if (usedConsumption && basis.pieces !== null && !buyQty) notes.push("单耗还不是数字，要买数量先空着");
    if (basis.dropped) notes.push("写下不下的颜色没有算进去");
    if (basis.unreadable && basis.basis === "bulk") notes.push("部分颜色数量待确认，本款要买数量暂不计算");
    lines.push({
      name: usedName.slice(0, 80),
      consumption: usedConsumption,
      price: usedPrice,
      buyQty,
      note: notes.join("。"),
    });
  }
  add(sample.composition || bulk.composition || "面布", sample.shellConsumption, sample.shellPrice);
  add("里布", sample.liningConsumption, sample.liningPrice);
  add("扣子", "", sample.buttonPrice);
  add("其他辅料", "", sample.otherTrimCost);
  return lines;
}

export function constructionPurchaseLines(rows: StoredConstructionItem[], sample: SalesSample, bulk: BulkSheet, kind: string): PurchaseLine[] {
  const basis = pieceBasis(sample, bulk, kind);
  return rows.filter(r => r.group !== "process").map(r => ({ name: `${r.name}（${r.fields.unit || "单位待补"}）`, consumption: r.fields.consumption || "", price: "", buyQty: scaleConsumption(r.fields.consumption || "", basis.pieces), note: ["按本阶段已保存用料计算，仅为毛需求，不是采购单", !r.fields.consumption ? "单耗待确认" : "", basis.pieces === null ? "件数待确认，暂不计算" : "", basis.dropped ? "不下颜色未计入" : ""].filter(Boolean).join("；") }));
}

export type GuestMark = "" | "pending" | "yes" | "no";

export type DipColor = {
  name: string;
  guest: GuestMark;
};

export type LabDip = {
  fabricColors: DipColor[];
  trimColors: DipColor[];
};

export const TRIM_DIP_NAMES = ["金属标", "纽扣", "拉链", "裤钩", "其他辅料"] as const;

export function emptyLabDip(): LabDip {
  return {
    fabricColors: [],
    trimColors: TRIM_DIP_NAMES.map((name) => ({ name, guest: "" })),
  };
}

function guestMark(value: unknown): GuestMark {
  if (value === "pending" || value === "yes" || value === "no") return value;
  return "";
}

export function readLabDip(json: string): LabDip {
  const raw = readObject(json);
  const fabricColors = Array.isArray(raw.fabricColors) ? raw.fabricColors : [];
  const trimColors = Array.isArray(raw.trimColors) ? raw.trimColors : [];
  const trims = TRIM_DIP_NAMES.map((name) => {
    const found = trimColors.find((row) => row && typeof row === "object" && clip((row as { name?: unknown }).name, 40) === name);
    const item = found && typeof found === "object" ? (found as Record<string, unknown>) : {};
    return { name, guest: guestMark(item.guest) };
  });
  return {
    fabricColors: fabricColors
      .map((row) => {
        const item = row && typeof row === "object" ? (row as Record<string, unknown>) : {};
        return { name: clip(item.name, 80), guest: guestMark(item.guest) };
      })
      .filter((row) => row.name)
      .slice(0, MAX_COLORS),
    trimColors: trims,
  };
}

export function progressSentence(sheet: { progress: string; fabricProgress: string; buttonProgress: string; zipperProgress: string }) {
  const parts = [
    sheet.progress.trim(),
    sheet.fabricProgress.trim() ? `面料：${sheet.fabricProgress.trim()}` : "",
    sheet.buttonProgress.trim() ? `扣子：${sheet.buttonProgress.trim()}` : "",
    sheet.zipperProgress.trim() ? `拉链：${sheet.zipperProgress.trim()}` : "",
  ];
  return parts.filter(Boolean).join("；");
}

export type MerchStyle = {
  rowId?: string;
  styleCode: string;
  styleName: string;
  craftFamily: CraftFamily | "";
  imagePath: string;
  labDip: LabDip;
  salesSample: SalesSample;
  bulk: BulkSheet;
};

export function emptyMerchStyle(): MerchStyle {
  return {
    styleCode: "",
    styleName: "",
    craftFamily: "",
    imagePath: "",
    labDip: emptyLabDip(),
    salesSample: emptySalesSample(),
    bulk: emptyBulk(),
  };
}

function styleHasContent(style: MerchStyle) {
  if (style.styleCode || style.styleName || style.craftFamily || style.imagePath) return true;
  if (style.labDip.fabricColors.length) return true;
  if (style.labDip.trimColors.some((row) => row.guest)) return true;
  if (style.bulk.colors.length) return true;
  if (Object.values(style.salesSample.pictures).some((rows) => rows.length > 0)) return true;
  if (style.salesSample.elements?.length) return true;
  if (Object.entries(style.salesSample).some(([key, value]) => key !== "pictures" && key !== "elements" && Boolean(value))) return true;
  if (Object.values(style.bulk.pictures ?? {}).some(images => images?.length)) return true;
  return Object.entries(style.bulk).some(([key, value]) => key !== "colors" && key !== "pictures" && Boolean(value));
}

export function normalizeMerchOrder(input: { seasonCode?: unknown; styles?: unknown }) {
  if (!Array.isArray(input.styles)) throw new Error("请按款填写这一单");
  if (input.styles.length > 40) throw new Error("一单里的款太多");
  const styles = input.styles.flatMap((row) => {
    const item = row && typeof row === "object" ? (row as Record<string, unknown>) : {};
    const one = normalizeMerchSheet({
      craftFamily: item.craftFamily ?? "",
      salesSample: item.salesSample,
      bulk: item.bulk,
    });
    const style: MerchStyle = {
      ...(clip(item.rowId, 100) ? { rowId: clip(item.rowId, 100) } : {}),
      styleCode: clip(item.styleCode, 80),
      styleName: clip(item.styleName, 80),
      craftFamily: one.craftFamily,
      imagePath: sheetImagePath(item.imagePath),
      labDip: readLabDip(JSON.stringify(item.labDip ?? {})),
      salesSample: one.salesSample,
      bulk: one.bulk,
    };
    return styleHasContent(style) ? [style] : [];
  });
  return {
    seasonCode: clip(input.seasonCode, 40),
    styles,
    fingerprint: JSON.stringify({
      seasonCode: clip(input.seasonCode, 40),
      styles: styles.map((style) => ({
        styleCode: style.styleCode,
        styleName: style.styleName,
        craftFamily: style.craftFamily,
        imagePath: style.imagePath,
        labDip: style.labDip,
        salesSample: style.salesSample,
        bulk: style.bulk,
      })),
    }),
  };
}

export function readStoredMerchStyles(
  sheet: {
    craftFamily: string;
    salesSampleJson: string;
    bulkJson: string;
    styles: Array<{
      id?: string;
      styleCode: string;
      styleName: string;
      craftFamily: string;
      imagePath?: string;
      labDipJson?: string;
      salesSampleJson: string;
      bulkJson: string;
    }>;
  } | null,
  fallback: { styleCode: string; styleName: string },
): MerchStyle[] {
  if (!sheet) return [];
  if (sheet.styles.length) {
    return sheet.styles.map((row) => ({
      ...(row.id ? { rowId: row.id } : {}),
      styleCode: row.styleCode,
      styleName: row.styleName,
      craftFamily: row.craftFamily === "sweater" || row.craftFamily === "knit" || row.craftFamily === "woven" ? row.craftFamily : "",
      imagePath: sheetImagePath(row.imagePath),
      labDip: readLabDip(row.labDipJson ?? "{}"),
      salesSample: readSalesSample(row.salesSampleJson),
      bulk: readBulk(row.bulkJson),
    }));
  }
  const legacy = normalizeMerchSheet({
    craftFamily: sheet.craftFamily,
    salesSample: readSalesSample(sheet.salesSampleJson),
    bulk: readBulk(sheet.bulkJson),
  });
  const style: MerchStyle = {
    styleCode: fallback.styleCode,
    styleName: fallback.styleName,
    craftFamily: legacy.craftFamily,
    imagePath: "",
    labDip: emptyLabDip(),
    salesSample: legacy.salesSample,
    bulk: legacy.bulk,
  };
  return styleHasContent(style) ? [style] : [];
}

function joinParts(parts: string[]) {
  return parts.map((item) => item.trim()).filter(Boolean).join("；");
}

export function buildSeasonBoard(sources: SeasonSource[]): SeasonBoard {
  const counts = { sweater: 0, knit: 0, woven: 0, unset: 0 };
  const seenStyle = new Set<string>();
  const factoryMap = new Map<string, string[]>();
  const rows: SeasonRow[] = [];
  const purchases: SeasonBoard["purchases"] = [];

  for (const source of sources) {
    const styleKey = source.styleCode.trim()
      || (source.styleName.trim() ? `${source.orderId}:${source.styleName.trim()}` : `${source.orderId}:row:${rows.length}`);
    if (!seenStyle.has(styleKey)) {
      seenStyle.add(styleKey);
      if (source.craftFamily === "sweater" || source.craftFamily === "knit" || source.craftFamily === "woven") {
        counts[source.craftFamily] += 1;
      } else {
        counts.unset += 1;
      }
    }
    const factoryName = source.factoryName.trim() || source.salesSample.factoryName.trim() || "还没写工厂";
    const styleLabel = [source.styleCode, source.styleName].filter(Boolean).join(" ") || source.orderNo;
    const bucket = factoryMap.get(factoryName) ?? [];
    if (!bucket.includes(styleLabel)) bucket.push(styleLabel);
    factoryMap.set(factoryName, bucket);

    const colorQty = source.bulk.colors.length
      ? source.bulk.colors.map((row) => `${row.guestColor || "未写颜色"} ${row.qtyText || "件数空着"}`).join("、")
      : source.salesSample.colors;
    const metal = joinParts([
      ...source.bulk.colors.map((row) => [row.guestColor, row.metalBadge].filter(Boolean).join(" ")),
      source.salesSample.metalBadge,
    ]);
    rows.push({
      orderId: source.orderId,
      orderNo: source.orderNo,
      href: source.href || `/orders/${source.orderId}#merch`,
      styleCode: source.styleCode,
      styleName: source.styleName,
      imagePath: source.imagePath,
      composition: source.bulk.composition || source.salesSample.composition,
      colorQty,
      delivery: joinParts([source.bulk.inboundDate, source.bulk.shipDate]),
      trims: joinParts([
        metal ? `金属标 ${metal}` : "",
        source.bulk.button ? `纽扣 ${source.bulk.button}` : "",
        source.bulk.zipper ? `拉链 ${source.bulk.zipper}` : "",
        source.bulk.hook ? `裤钩 ${source.bulk.hook}` : "",
        source.bulk.otherTrim ? `其他 ${source.bulk.otherTrim}` : "",
        source.salesSample.mainLabel ? `主唛 ${source.salesSample.mainLabel}` : "",
        source.salesSample.hangtag ? `挂牌 ${source.salesSample.hangtag}` : "",
        source.salesSample.sticker ? `贴纸 ${source.salesSample.sticker}` : "",
      ]),
      progress: source.bulk.progress || source.bulk.fabricProgress || source.bulk.buttonProgress || source.bulk.zipperProgress
        ? progressSentence(source.bulk)
        : progressSentence(source.salesSample),
      factoryName,
      seasonCode: source.seasonCode,
      craftLabel: craftLabel(source.craftFamily),
    });
    for (const line of source.construction ? constructionPurchaseLines(source.construction, source.salesSample, source.bulk, source.kind || "bulk") : purchaseLines(source.salesSample, source.bulk, source.kind)) {
      purchases.push({ ...line, styleCode: source.styleCode || source.orderNo, orderNo: source.orderNo });
    }
  }

  return {
    counts,
    factories: [...factoryMap.entries()].map(([name, styles]) => ({ name, styles })),
    rows,
    purchases,
  };
}
