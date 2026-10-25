import { z } from "zod";
import { isFullDate } from "@/server/domain/follow-po";

export const INTAKE_WORKFLOW = "customer-po-follow-v1";
const text = (max = 200) => z.string().trim().max(max);
const date = text(10).refine(v => !v || isFullDate(v), "日期请填写完整的年、月、日");
export const IntakeItem = z.object({
  styleId: text(), productCode: text(80), styleName: text(80), craftFamily: z.enum(["", "sweater", "knit", "woven"]),
  composition: text(400), note: text(400),
  colors: z.array(z.object({ name: text(80), quantity: text(30) }).strict()).max(40),
}).strict();
export const IntakeDraft = z.object({
  title: text(80), customerId: text(), factoryId: text(), seasonCode: text(40), po: text(100),
  purchaseDate: date, shipDate: date, inboundDate: date, note: text(300),
  items: z.array(IntakeItem).min(1).max(20),
}).strict();
export type IntakeDraftValue = z.infer<typeof IntakeDraft>;
export type IntakeCatalog = {
  customers: Array<{ id: string; name: string; code: string }>;
  factories: Array<{ id: string; name: string; code: string }>;
  styles: Array<{ id: string; code: string; name: string; productCodes?: string[] }>;
};
export const emptyIntakeItem = (): IntakeDraftValue["items"][number] => ({ styleId: "", productCode: "", styleName: "", craftFamily: "", composition: "", note: "", colors: [{ name: "", quantity: "" }] });
export const emptyIntakeDraft = (): IntakeDraftValue => ({ title: "", customerId: "", factoryId: "", seasonCode: "", po: "", purchaseDate: "", shipDate: "", inboundDate: "", note: "", items: [emptyIntakeItem()] });
export function intakeMissing(draft: IntakeDraftValue) {
  const missing: string[] = [];
  if (!draft.title) missing.push("跟单名称");
  if (!draft.customerId) missing.push("客户");
  if (!draft.factoryId) missing.push("负责工厂");
  for (const [i, item] of draft.items.entries()) {
    if (!item.styleId && !item.styleName) missing.push(`第 ${i + 1} 款品名或关联款式`);
    if (!item.colors.length) missing.push(`第 ${i + 1} 款颜色行`);
    for (const [j, c] of item.colors.entries()) {
      if (!c.name) missing.push(`第 ${i + 1} 款第 ${j + 1} 行颜色`);
      if (!/^(?:[1-9]\d{0,7}|0|不下)$/.test(c.quantity)) missing.push(`第 ${i + 1} 款第 ${j + 1} 行件数（整数或“不下”）`);
    }
  }
  return missing;
}
export function intakeWarnings(draft: IntakeDraftValue) {
  return [...(!draft.po ? ["客户 PO 待补，不沿用历史 PO"] : []), ...(!draft.purchaseDate ? ["客户采购日期待补"] : []), ...(!draft.shipDate ? ["要求出货日期待补"] : []),
    ...draft.items.flatMap((item, i) => [...(!item.styleId ? [`第 ${i + 1} 款尚未关联主款，只保留在跟单上`] : []), ...(!item.productCode ? [`第 ${i + 1} 款产品编号待补`] : [])])];
}
