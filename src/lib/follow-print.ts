import { COLOR_TRIM_FIELDS, BULK_LABEL_KEYS, BULK_PROCESS_KEYS, bulkMainLabel, colorTrimText, type ColorTrimKey } from "@/server/domain/merch-sheet";
import type { FollowStyleLine } from "@/server/services/order-merch";
import type { MasterColumn } from "@/lib/follow-master";

const labelKeys: ColorTrimKey[] = [...BULK_LABEL_KEYS, "careSizeLabel"];
const trimKeys: ColorTrimKey[] = [...BULK_PROCESS_KEYS];
export type PrintValue = { label: string; value: string; reference?: number };
export type PrintNote = { number: number; label: string; text: string; rows: number[]; allColors: boolean };
export type PrintPictures = { label: string; images: string[]; rows: number[]; shared: boolean };

/** Print-only projection: preserve text verbatim, never infer or update business fields. */
export function followPrintContent(line: FollowStyleLine, columns: MasterColumn[]) {
  const colors = line.colors.length ? line.colors : [{ guestColor: "", factoryColorName: "", qtyText: "", metalBadge: "", colorTrims: undefined }];
  const notes: PrintNote[] = [];
  const pictures: PrintPictures[] = [];
  function addPictures(label: string, images: string[] | undefined, row?: number) {
    if (!images?.length) return;
    const shared = row === undefined;
    const existing = pictures.find(p => p.label === label && p.shared === shared && JSON.stringify(p.images) === JSON.stringify(images));
    if (existing && row !== undefined) existing.rows.push(row);
    else pictures.push({ label, images, rows: row === undefined ? [] : [row], shared });
  }
  if (columns.includes("labels")) addPictures("主唛", line.bulkPictures?.mainLabel);
  if (columns.includes("trims")) for (const [key, label] of [["button", "纽扣"], ["zipper", "拉链"], ["hook", "裤钩"], ["otherTrim", "本款其他辅料"]] as const) addPictures(label, line.bulkPictures?.[key]);
  colors.forEach((color, index) => {
    if (columns.includes("labels")) for (const key of BULK_LABEL_KEYS) addPictures(COLOR_TRIM_FIELDS[key], color.pictures?.[key], index + 1);
    if (columns.includes("trims")) for (const key of BULK_PROCESS_KEYS) addPictures(COLOR_TRIM_FIELDS[key], color.pictures?.[key], index + 1);
    addPictures("金属标", color.pictures?.metalBadge, index + 1);
  });
  function value(label: string, text: string | undefined, row: number): PrintValue[] {
    if (!text?.trim()) return [];
    // Long text is never ellipsized. Put its exact value in a wide note and reference it.
    if (text.length > 56 || text.split(/\r?\n/).length > 2) {
      let note = notes.find(note => note.label === label && note.text === text);
      if (!note) { note = { number: notes.length + 1, label, text, rows: [], allColors: false }; notes.push(note); }
      note.rows.push(row);
      return [{ label, value: `见说明 ${note.number}`, reference: note.number }];
    }
    return [{ label, value: text }];
  }
  const rows = colors.map((color, index) => ({
    number: index + 1, color: color.guestColor, factoryColor: color.factoryColorName, quantity: color.qtyText,
    labels: columns.includes("labels") ? labelKeys.flatMap(key => value(key === "careSizeLabel" ? "原洗唛 / 尺码唛合并说明" : COLOR_TRIM_FIELDS[key], colorTrimText(color, key), index + 1)) : [],
    trims: [
      ...value("金属标", color.metalBadge, index + 1),
      ...(columns.includes("trims") ? trimKeys.flatMap(key => value(key === "careSizeLabel" ? "原洗唛 / 尺码唛合并说明" : COLOR_TRIM_FIELDS[key], colorTrimText(color, key), index + 1)) : []),
    ],
  }));
  for (const note of notes) note.allColors = note.rows.length === colors.length;
  const details: Array<{ label: string; text: string; section: string; href?: string }> = [];
  if (columns.includes("materials")) {
    details.push({ label: "面料成分 / 规格 / 单耗", text: [line.composition || "成分待补", line.gsm && `${line.gsm} GSM`, line.shellWidth && `门幅 ${line.shellWidth}`, line.shellConsumption && `单耗 ${line.shellConsumption}`, line.materialSummary && `本单资料：${line.materialSummary}`].filter(Boolean).join(" · "), section: "follow-materials" });
  }
  if (columns.includes("trims")) {
    const accessories = [line.button && `纽扣：${line.button}`, line.zipper && `拉链：${line.zipper}`, line.hook && `裤钩：${line.hook}`].filter(Boolean).join("；");
    if (accessories) details.push({ label: "本款纽扣 / 拉链 / 裤钩", text: accessories, section: "follow-colors" });
    if (line.otherTrim.trim()) details.push({ label: "本款其他辅料", text: line.otherTrim, section: "follow-colors" });
  }
  if (columns.includes("progress")) {
    details.push({ label: "跟单 / 面辅料进度", text: line.progress || "进度待补", section: "follow-progress" });
    details.push({ label: "生产与出运登记", text: line.productionHref ? [`生产单 ${line.productionOrderNo}`, line.productionProgress, `出运登记：${line.shipmentDates.join("、") || "暂无可归属此 PO 的登记"}`].filter(Boolean).join(" · ") : "尚未开生产订单", section: "follow-progress", href: line.productionHref || undefined });
  }
  return { rows, notes, details, pictures, mainLabel: columns.includes("labels") ? bulkMainLabel({ mainLabel: line.bulkMainLabel, colors }) : "" };
}
