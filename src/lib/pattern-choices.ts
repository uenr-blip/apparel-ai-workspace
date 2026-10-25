/** Suggestions are saved typing aids, never approved specifications or live quotations. */
export const PATTERN_CHOICE_FIELDS = [
  "sweater.yarnComposition", "sweater.yarnCount", "sweater.bodyStructure", "sweater.needleType",
  "sweater.yarnSupplier", "sweater.yarnPrice", "sweater.customYarnPrice",
  "fabric.fabricComposition", "fabric.gsm", "fabric.spec", "fabric.width", "fabric.supplier",
  "fabric.price", "fabric.orderQtyPrice", "fabric.lining", "fabric.trims",
] as const;
export type PatternChoiceField = typeof PATTERN_CHOICE_FIELDS[number];
export type PatternChoice = { value: string; source: string; detail?: string; supplier?: string; hidden?: boolean };
export type PatternChoiceVisibility = { field: PatternChoiceField; value: string; supplier?: string; hidden: boolean; expectedHidden: boolean };
export type PatternChoices = Partial<Record<PatternChoiceField, PatternChoice[]>>;
export const PATTERN_PRICE_FIELDS: readonly string[] = ["sweater.yarnPrice", "sweater.customYarnPrice", "fabric.price", "fabric.orderQtyPrice"];
export function isPatternChoiceField(field: string): field is PatternChoiceField {
  return (PATTERN_CHOICE_FIELDS as readonly string[]).includes(field);
}
export function choiceKey(value: string) { return value.trim().normalize("NFKC").toLocaleLowerCase(); }
export function choiceIdentity(field: PatternChoiceField, row: Pick<PatternChoice, "value" | "supplier">) {
  return JSON.stringify([field, choiceKey(row.value), PATTERN_PRICE_FIELDS.includes(field) ? choiceKey(row.supplier ?? "") : ""]);
}
export function choicesForField(choices: PatternChoices, field: PatternChoiceField, supplier: string): PatternChoice[] {
  const rows = choices[field] ?? [];
  return PATTERN_PRICE_FIELDS.includes(field) ? rows.filter(row => choiceKey(row.supplier ?? "") === choiceKey(supplier)) : rows;
}
const examples: Partial<Record<PatternChoiceField, string[]>> = {
  "sweater.yarnComposition": ["100%棉", "100%羊毛"],
  "sweater.yarnCount": ["2/32", "2/48"],
  "sweater.bodyStructure": ["平针", "罗纹", "提花", "绞花"],
  "sweater.needleType": ["5G", "7G", "12G", "14G"],
  "fabric.fabricComposition": ["100%棉", "100%亚麻", "100%涤纶"],
  "fabric.spec": ["平纹", "斜纹", "缎纹", "罗纹"],
  "fabric.lining": ["无里布", "全里", "半里"],
  "fabric.trims": ["纽扣", "拉链", "主唛", "洗水唛", "尺码唛"],
};
export const COMMON_PATTERN_CHOICES: PatternChoices = Object.fromEntries(
  Object.entries(examples).map(([field, values]) => [field, values.map(value => ({ value, source: "常用示例 · 请按本款核对" }))]),
);
