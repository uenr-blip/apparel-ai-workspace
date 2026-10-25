import type { Extraction } from "@/server/ai/schema";

export const MAX_AI_INPUT_CHARS = 50_000;
type Located = { sourceText: string | null; start: number | null; end: number | null };

export class EvidenceError extends Error {
  constructor(field: string) {
    super(`来源证据校验失败：${field}，请核对原文后重新解析`);
    this.name = "EvidenceError";
  }
}

export function assertInputLimit(text: string) {
  if (text.length > MAX_AI_INPUT_CHARS) throw new Error("资料超过解析长度上限，请分批提交");
}

/** Valid JSON is not evidence. Every supplied location must exactly match this source. */
export function assertExtractionEvidence(text: string, extraction: Extraction) {
  const check = (name: string, field: Located, required: boolean) => {
    const absent = field.sourceText === null && field.start === null && field.end === null;
    if (absent && !required) return;
    if (
      !field.sourceText || field.start === null || field.end === null ||
      !Number.isSafeInteger(field.start) || !Number.isSafeInteger(field.end) ||
      field.start < 0 || field.end <= field.start || field.end > text.length ||
      text.slice(field.start, field.end) !== field.sourceText
    ) throw new EvidenceError(name);
  };
  for (const name of ["customerName", "styleCode", "reuseExistingStyle", "externalCustomerPo", "totalQuantity", "deliveryText", "deliveryDateInferred"] as const) {
    const field = extraction[name];
    check(name, field, field.kind === "extracted" && field.value !== null);
    if ((field.kind === "unknown" || field.kind === "conflict") && field.value !== null) throw new EvidenceError(name);
    if (field.kind === "inferred" && field.value !== null && !field.inferenceNote?.trim()) throw new EvidenceError(name);
  }
  for (const name of ["colors", "materials", "modifications", "sizeLines"] as const) {
    extraction[name].forEach((field, index) => check(`${name}[${index}]`, field, true));
  }
  const total = extraction.totalQuantity.value;
  if (total !== null && (!Number.isSafeInteger(Number(total)) || Number(total) < 0 || Number(total) > 2_147_483_647)) {
    throw new EvidenceError("totalQuantity");
  }
  const hasNumber = (source: string | null, quantity: number) =>
    [...(source ?? "").matchAll(/\d+(?:,\d{3})*(?:\.\d+)?/g)].some(match => Number(match[0].replaceAll(",", "")) === quantity);
  if (total !== null && extraction.totalQuantity.kind === "extracted" && !hasNumber(extraction.totalQuantity.sourceText, Number(total))) {
    throw new EvidenceError("totalQuantity");
  }
  if (total !== null && extraction.totalQuantity.kind === "inferred" &&
      (!extraction.colors.length || extraction.colors.reduce((sum, color) => sum + color.quantity, 0) !== Number(total))) {
    throw new EvidenceError("totalQuantity");
  }
  for (const name of ["colors", "sizeLines"] as const) {
    extraction[name].forEach((field, index) => {
      if (!Number.isSafeInteger(field.quantity) || field.quantity < 0 || field.quantity > 2_147_483_647 || !hasNumber(field.sourceText, field.quantity)) {
        throw new EvidenceError(`${name}[${index}]`);
      }
    });
  }
}
