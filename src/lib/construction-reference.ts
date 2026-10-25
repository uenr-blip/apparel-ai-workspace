import { readSalesSample } from "@/server/domain/merch-sheet";

export type ConstructionReference = { label: string; text: string; images: string[] };
/** Keep older free-form descriptions verbatim; never guess a material, quantity or category. */
export function constructionReferences(snapshotJson?: string | null): ConstructionReference[] {
  const snapshot = JSON.parse(snapshotJson || "{}") as { followRow?: { salesSampleJson?: string }; references?: ConstructionReference[] };
  if (snapshot.references) return snapshot.references;
  if (!snapshot.followRow?.salesSampleJson) return [];
  const sample = readSalesSample(snapshot.followRow.salesSampleJson);
  const plain = [
    ["面料成分", sample.composition], ["克重", sample.gsm], ["面料幅宽", sample.shellWidth], ["面料单耗", sample.shellConsumption],
    ["里布幅宽", sample.liningWidth], ["里布单耗", sample.liningConsumption], ["贴纸", sample.sticker],
  ].map(([label, text]) => ({ label, text, images: [] as string[] }));
  const pictured = (["metalBadge", "liningColor", "mainLabel", "hangtag", "note"] as const).map(key => ({ label: { metalBadge: "金属标", liningColor: "里布颜色", mainLabel: "主唛", hangtag: "吊牌", note: "原备注" }[key], text: sample[key], images: sample.pictures[key] }));
  return [...plain, ...pictured, ...(sample.elements || []).map(e => ({ label: e.label, text: e.text, images: e.images }))].filter(r => r.text || r.images.length);
}
