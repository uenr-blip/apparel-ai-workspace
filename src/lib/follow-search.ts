import { BULK_LABEL_KEYS, BULK_PROCESS_KEYS, colorTrimText } from "@/server/domain/merch-sheet";
import type { FollowProductLists, FollowStyleLine } from "@/server/services/order-merch";
import { isFullDate } from "@/server/domain/follow-po";

export function filterFollowProducts(lists: FollowProductLists, query: string, from = "", to = "") {
  const needle = query.trim().toLocaleLowerCase();
  const matches = (line: FollowStyleLine) => {
    if ((from && !isFullDate(from)) || (to && !isFullDate(to)) || (from && to && from > to)) return false;
    if (from && (!line.purchaseDate || line.purchaseDate < from)) return false;
    if (to && (!line.purchaseDate || line.purchaseDate > to)) return false;
    return !needle || [line.po, line.numericCode, line.orderNo, line.productionOrderNo, line.purchaseDate,
      line.shipDate, line.bulkMainLabel, line.mainLabel, line.sampleMetal, line.hangtag, line.note, line.liningColor, line.colorOpinion, line.progress, ...(line.sampleElements || []).flatMap(e => [e.label, e.text]), ...line.shipmentDates, line.seasonCode, line.composition, line.materialSummary, line.button, line.zipper, line.hook, line.otherTrim, line.styleCode, line.styleName, line.factoryName, line.sheetTitle,
      ...line.colors.flatMap(c => [c.guestColor, c.factoryColorName, c.metalBadge, ...Object.values(c.colorTrims ?? {}), ...[...BULK_LABEL_KEYS, ...BULK_PROCESS_KEYS].map(k => colorTrimText(c, k))]), line.sampleColors,
    ].some(value => (value ?? "").toLocaleLowerCase().includes(needle));
  };
  return {
    sales: lists.sales.filter(matches),
    bulk: lists.bulk.map(group => ({ ...group, styles: group.styles.filter(matches) })).filter(group => group.styles.length),
    emptySheets: from || to ? [] : lists.emptySheets.filter(sheet => !needle || sheet.title.toLocaleLowerCase().includes(needle)),
  };
}
