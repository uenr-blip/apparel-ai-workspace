import type { MerchStyle } from "./merch-sheet";

export function customerPo(style: MerchStyle, kind: string) {
  // The old orderNo column may contain an internal number. Never promote it silently.
  return (kind === "sales_sample" ? style.salesSample.po : style.bulk.po).trim();
}

export function isFullDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/** Validate explicit facts only; absent PO/product numbers remain allowed. */
export function validateFollowPo(styles: MerchStyle[], kind: string) {
  const productIds = new Map<string, string>();
  const styleIds = new Map<string, string>();
  const purchaseDates = new Map<string, string>();
  for (const style of styles) {
    const code = style.styleCode.trim().toUpperCase();
    const productId = style.salesSample.numericCode.trim();
    if (code && productId) {
      if (productIds.has(code) && productIds.get(code) !== productId) throw new Error(`${style.styleCode} 的产品编号不一致；同一产品各 PO 沿用同一个编号`);
      if (styleIds.has(productId) && styleIds.get(productId) !== code) throw new Error(`产品编号 ${productId} 对应了不同款式，请核对`);
      productIds.set(code, productId);
      styleIds.set(productId, code);
    }
    if (kind === "sales_sample") continue;
    const date = style.bulk.purchaseDate;
    if (date && !isFullDate(date)) throw new Error("客户采购日期请填写真实的完整日期（YYYY-MM-DD）");
    const po = customerPo(style, kind).toUpperCase();
    if (po && date) {
      if (purchaseDates.has(po) && purchaseDates.get(po) !== date) throw new Error(`PO ${customerPo(style, kind)} 的客户采购日期不一致，请核对原单`);
      purchaseDates.set(po, date);
    }
  }
}

export function productionPoFacts(styles: MerchStyle[], kind: string) {
  validateFollowPo(styles, kind);
  const pos = [...new Set(styles.map(s => customerPo(s, kind).toUpperCase()))];
  if (pos.length > 1) throw new Error("这张跟单含不同 PO 或部分款未填 PO，请按客户 PO 分成跟单后分别开生产订单，避免批次混在一起");
  const dates = [...new Set(styles.map(s => s.bulk.shipDate).filter(Boolean))];
  if (dates.length > 1) throw new Error("同一生产订单的要求出货日期不同，请核对或分单后再开");
  return {
    po: styles[0] ? customerPo(styles[0], kind) : "",
    purchaseDate: styles.find(s => s.bulk.purchaseDate)?.bulk.purchaseDate ?? "",
    requestedShipDate: kind === "sales_sample" ? "" : dates[0] ?? "",
  };
}

/** Batch identity is immutable after opening; progress and trim notes remain editable. */
export function followBatchFingerprint(styles: MerchStyle[], kind: string) {
  return JSON.stringify(styles.map(s => ({
    styleCode: s.styleCode,
    productCode: s.salesSample.numericCode,
    po: customerPo(s, kind),
    purchaseDate: s.bulk.purchaseDate,
    shipDate: s.bulk.shipDate,
    colors: s.bulk.colors.map(c => ({ color: c.guestColor, quantity: c.qtyText })),
    sampleQuantity: kind === "sales_sample" ? s.salesSample.salesSample : "",
  })));
}
