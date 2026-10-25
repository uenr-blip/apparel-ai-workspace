import { z } from "zod";

export const CONSTRUCTION_GROUPS = ["fabric", "yarn", "regularTrim", "customTrim", "process"] as const;
export type ConstructionGroup = typeof CONSTRUCTION_GROUPS[number];
export type ConstructionMaterialChoice = { id: string; code: string; name: string; kind: string; unit: string; composition: string; gsm: string; widthCm: string; specSummary: string; hasImage?: boolean };
export const CONSTRUCTION_LABELS: Record<ConstructionGroup, string> = { fabric: "面料", yarn: "纱线", regularTrim: "常规辅料", customTrim: "非常规辅料", process: "特殊工艺" };
export const CONSTRUCTION_OPTIONS: Record<ConstructionGroup, string[]> = {
  fabric: [], yarn: [],
  regularTrim: ["金属标", "纸牌", "吊牌", "说明牌", "空白牌", "主唛", "洗水唛", "尺码唛", "纽扣", "拉链"],
  customTrim: ["定制拉链头", "装饰链条", "异形扣", "硅胶章", "皮牌", "织带", "流苏", "羽毛饰件", "珠片饰件"],
  process: ["绣花", "印花", "贴布绣", "压褶", "洗水", "烫钻", "激光切割", "压胶"],
};
export const CONSTRUCTION_FIELDS = {
  position: "使用部位", composition: "成分 / 材质", specification: "规格 / 组织", gsm: "克重（g/㎡）", width: "幅宽（cm）",
  yarnCount: "纱支 / 股数", color: "颜色 / 色号", size: "尺寸 / 型号", consumption: "单件用量", unit: "单位", notes: "要求 / 备注",
} as const;
export type ConstructionField = keyof typeof CONSTRUCTION_FIELDS;
export const GROUP_FIELDS: Record<ConstructionGroup, ConstructionField[]> = {
  fabric: ["position", "composition", "specification", "gsm", "width", "color", "consumption", "unit", "notes"],
  yarn: ["position", "composition", "yarnCount", "specification", "color", "consumption", "unit", "notes"],
  regularTrim: ["position", "composition", "specification", "size", "color", "consumption", "unit", "notes"],
  customTrim: ["position", "composition", "specification", "size", "color", "consumption", "unit", "notes"],
  process: ["position", "size", "color", "specification", "notes"],
};
const FieldValues = z.object(Object.fromEntries(Object.keys(CONSTRUCTION_FIELDS).map(k => [k, z.string().trim().max(k === "notes" ? 2000 : 300).optional()])) as Record<ConstructionField, z.ZodOptional<z.ZodString>>).strict();
export const ConstructionInput = z.array(z.object({
  key: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/), group: z.enum(CONSTRUCTION_GROUPS), name: z.string().trim().min(1, "请填写已添加项目的名称").max(120),
  materialId: z.string().max(100).optional(), fields: FieldValues, imageId: z.string().max(100).optional(), useMaterialImage: z.boolean().optional(),
}).strict()).max(60).superRefine((rows, ctx) => {
  if (new Set(rows.map(r => r.key)).size !== rows.length) ctx.addIssue({ code: "custom", message: "项目编号重复" });
});
export type ConstructionItem = z.infer<typeof ConstructionInput>[number];
export type ConstructionImage = { id: string; path: string; name: string; mime: string };
export type StoredConstructionItem = ConstructionItem & { image?: ConstructionImage };
export function readConstruction(raw: string | undefined | null): StoredConstructionItem[] {
  if (!raw) return [];
  return JSON.parse(raw) as StoredConstructionItem[];
}
export function constructionKind(group: ConstructionGroup) { return group === "fabric" || group === "yarn" ? group : "trim"; }
export function constructionPublic(rows: StoredConstructionItem[]): ConstructionItem[] {
  return rows.map(({ image, ...row }) => ({ ...row, imageId: image?.id }));
}
