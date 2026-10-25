import { z } from "zod";

export const StageTarget = z.union([
  z.object({ projectId: z.string().min(1).max(100) }).strict(),
  z.object({ followRowId: z.string().min(1).max(100) }).strict(),
]);
export type StageTargetInput = z.infer<typeof StageTarget>;
export const StageTransfer = z.object({
  target: StageTarget,
  patternRevisionId: z.string().max(100).optional(),
  title: z.string().trim().min(1, "请填写下一阶段的跟单名称").max(80),
  batchKey: z.string().trim().min(1, "请填写本次交接批次，便于防止重复转出").max(80),
  customerId: z.string().min(1, "请选择客户").max(100),
  factoryId: z.string().max(100).optional(),
  ownerId: z.string().min(1, "请选择接手人").max(100),
  seasonCode: z.string().trim().max(40),
  basis: z.string().trim().min(1, "请写明本次交接依据或客户确认记录").max(2000),
}).strict();
export type StageTransferInput = z.infer<typeof StageTransfer>;
export const StageMaterialSource = z.object({
  target: StageTarget,
  source: z.union([z.object({ versionId: z.string().min(1).max(100) }).strict(), z.object({ revisionId: z.string().min(1).max(100) }).strict()]),
  reason: z.string().trim().min(1, "请填写选用依据").max(2000),
}).strict();
export type StageMaterialSourceInput = z.infer<typeof StageMaterialSource>;
export function patternEdition(number: number) {
  return `${number === 1 ? "头版" : number === 2 ? "二版" : number === 3 ? "三版" : `${number}版`}（V${number}）`;
}
export const STAGE_LABELS: Record<string, string> = { development: "开发", sales_sample: "销售样", bulk: "大货" };
