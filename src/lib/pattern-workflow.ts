import { z } from "zod";
import { readPatternSheet, type CraftFamily } from "@/server/domain/craft-sheet";

export const PATTERN_FIELDS = {
  "sweater.yarnComposition": "纱线成分", "sweater.yarnCount": "纱线支数", "sweater.bodyStructure": "大身组织", "sweater.needleType": "针型",
  "fabric.fabricComposition": "面料成分", "fabric.gsm": "克重", "fabric.spec": "规格", "fabric.width": "门幅", "fabric.lining": "里布", "fabric.trims": "辅料",
} as const;
export type PatternField = keyof typeof PATTERN_FIELDS;
export const PatternFieldSchema = z.enum(Object.keys(PATTERN_FIELDS) as [PatternField, ...PatternField[]]);
const text = z.string().trim().max(400);
export const PicturePath = z.string().regex(/^\/api\/sheet-images\/[\w-]{8,80}$/);
export const ReferenceInput = z.object({
  id: z.string().min(1).max(100), kind: z.enum(["image", "revision", "catalog"]), sourceRevisionId: z.string().max(100).default(""),
  catalog: z.object({ sourceId: z.string().min(1).max(150), materialId: z.string().max(100), fingerprint: z.string().regex(/^[a-f0-9]{64}$/), includeImage: z.boolean() }).strict().optional(),
  images: z.array(PicturePath).max(6).default([]), label: text.min(1), scope: text.min(1), exclusions: text.default(""),
  mode: z.enum(["note", "fields"]), fields: z.array(PatternFieldSchema).max(10).default([]),
}).strict();
export type ReferenceInput = z.infer<typeof ReferenceInput>;
export type PatternReference = ReferenceInput & { sourceLabel: string; sourceValues: Partial<Record<PatternField, string>>; sourceSnapshot?: { family: string; values: Partial<Record<PatternField, string>>; images: string[] } };
export type PatternContent = ReturnType<typeof readPatternSheet> & { references: PatternReference[]; baseRevisionId: string | null };
export function readPatternContent(family: string, json: string): PatternContent {
  const base = readPatternSheet(family, json);
  let raw: Record<string, unknown> = {};
  try { raw = JSON.parse(json); } catch { /* Legacy empty draft. */ }
  return { ...base, references: Array.isArray(raw.references) ? raw.references as PatternReference[] : [], baseRevisionId: typeof raw.baseRevisionId === "string" ? raw.baseRevisionId : null };
}
export function fieldValue(content: PatternContent, field: PatternField) {
  const [group, key] = field.split(".");
  const values = group === "sweater" ? content.sweater : content.fabric;
  return (values as unknown as Record<string, string>)[key] || "";
}
export function fieldFits(family: string, field: PatternField) { return field.startsWith(family === "sweater" ? "sweater." : "fabric."); }
export function applyReferenceFields(content: PatternContent, source: PatternContent, fields: PatternField[]): PatternContent {
  const next = { ...content, sweater: { ...content.sweater }, fabric: { ...content.fabric } };
  for (const field of fields) {
    if (!fieldFits(content.craftFamily, field) || !fieldFits(source.craftFamily, field)) throw new Error("版单类型不兼容，请只作说明，或先核对本单类型");
    const [group, key] = field.split(".");
    (next[group as "sweater" | "fabric"] as unknown as Record<string, string>)[key] = fieldValue(source, field);
  }
  return next;
}
export function patternDiff(before: PatternContent, after: PatternContent) {
  const names: Record<string, string> = { craftFamily: "版单类型", origin: "来源", originNote: "来源说明", imagePath: "款式图", imageNote: "图注", yarnSupplier: "纱线供应商", yarnPrice: "纱线价格", inStock: "库存情况", customYarnPrice: "定制纱价格", supplier: "供应商", price: "价格", orderQtyPrice: "定数量和价格" };
  const flat = (c: PatternContent): Record<string, string> => ({ craftFamily: ({ sweater: "毛衣", knit: "针织", woven: "梭织" } as Record<string, string>)[c.craftFamily] || "未选择", origin: c.origin, originNote: c.originNote, ...Object.fromEntries(Object.entries(c.sweater).map(([k,v]) => [`sweater.${k}`,v])), ...Object.fromEntries(Object.entries(c.fabric).map(([k,v]) => [`fabric.${k}`,v])), references: JSON.stringify(c.references) });
  const a = flat(before), b = flat(after);
  return Object.keys(b).filter(key => a[key] !== b[key]).map(key => ({ key, label: PATTERN_FIELDS[key as PatternField] || names[key] || names[key.split(".").at(-1)!] || "参考依据", before: key === "references" ? before.references.map(referenceSummary).join("；") : a[key], after: key === "references" ? after.references.map(referenceSummary).join("；") : b[key] }));
}
const date = z.string().refine(s => !s || /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s)) && new Date(s).toISOString().slice(0,10) === s, "日期格式不正确");
const amount = z.string().trim().refine(s => !s || /^\d{1,9}(\.\d{1,3})?$/.test(s), "金额请填写非负数字，未报价请留空");
export const SampleQuote = z.object({ sampleFee: amount.default(""), unitPrice: amount.default(""), currency: z.string().regex(/^$|^[A-Z]{3}$/).default(""), quotedOn: date.default(""), bulkQuantity: text.default(""), basis: text.default("") }).strict().refine(q => !(q.sampleFee || q.unitPrice) || !!q.currency, "报价有金额时须填写币种");
export const SampleFeedback = z.object({ returnedOn: date.default(""), images: z.array(PicturePath).max(6).default([]), factoryNote: text.default(""), review: z.enum(["pending", "rework", "acceptable"]).default("pending"), reviewNote: text.default("") }).strict();
export type SampleQuote = z.infer<typeof SampleQuote>;
export type SampleFeedback = z.infer<typeof SampleFeedback>;
export const emptyQuote = (): SampleQuote => ({ sampleFee: "", unitPrice: "", currency: "", quotedOn: "", bulkQuantity: "", basis: "" });
export const emptyFeedback = (): SampleFeedback => ({ returnedOn: "", images: [], factoryNote: "", review: "pending", reviewNote: "" });
export type RevisionView = { id: string; number: number; parentId: string | null; reason: string; createdAt: string; createdByName: string; content: PatternContent };
export type SampleView = { id: string; revisionId: string; revisionNumber: number; factoryId: string; factoryName: string; round: number; quantity: number; dueDate: string; requirements: string; quote: SampleQuote; feedback: SampleFeedback; internalOpinion: string; updatedAt: string; ownerId: string; ownerName: string; issuedAt: string | null; receivedAt: string | null };
export type PatternBoard = { projectId: string; code: string; name: string; updatedAt: string; content: PatternContent; revisions: RevisionView[]; samples: SampleView[]; factories: { id: string; name: string }[]; contextStamp: string; choices?: import("./pattern-choices").PatternChoices };
export type PatternSuggestion = { projectId: string; sourceRevisionId: string; mode: "note" | "fields"; fields: PatternField[]; scope: string; exclusions: string };
export const PatternReferenceRequest = z.object({ projectId:z.string().min(1), sourceRevisionId:z.string().min(1), mode:z.enum(["note","fields"]), fields:z.array(PatternFieldSchema).max(10), scope:z.string().trim().min(1).max(400), exclusions:z.string().trim().max(400), values:z.partialRecord(PatternFieldSchema,z.string().max(400)).default({}) }).strict();
export type PatternFamily = CraftFamily;

export const referenceInput = (r: PatternReference): ReferenceInput => ({ id:r.id,kind:r.kind,sourceRevisionId:r.sourceRevisionId,images:r.images,label:r.label,scope:r.scope,exclusions:r.exclusions,mode:r.mode,fields:r.fields,...(r.catalog?{catalog:r.catalog}:{}) });

function referenceSummary(r: PatternReference) { return `${r.sourceLabel || r.label}：${r.scope}；不参考：${r.exclusions || "未注明"}；字段：${r.fields.map(f=>`${PATTERN_FIELDS[f]}=${r.sourceValues[f] || "未填"}`).join("、") || "仅说明"}；图片：${r.images.join("、") || "未附图"}`; }
