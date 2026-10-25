import { ACTION_TYPES } from "@/lib/constants";
import { prisma } from "@/lib/db";
import { createId } from "@/lib/hash";
import { canApproveAction } from "@/server/permissions";
import { ExecutionError } from "@/server/services/execution";
import { writeAudit } from "@/server/services/intake";
import { buildSpecSummary, writeMaterialCard } from "@/server/services/material-card";

const KINDS = new Set(["fabric", "yarn", "trim"]);

export async function createMaterialMaster(input: {
  organizationId: string;
  userId: string;
  role: string;
  code: string;
  name: string;
  kind: string;
  specSummary?: string;
  unit?: string;
  composition?: string;
  gsm?: string;
  widthCm?: string;
}) {
  if (!canApproveAction(input.role, ACTION_TYPES.createMaterialMaster)) {
    throw new ExecutionError("无权新建材料主档");
  }
  const code = input.code.trim();
  const name = input.name.trim();
  const kind = input.kind.trim();
  if (!code || !name) throw new ExecutionError("请填写货号和名称");
  if (!KINDS.has(kind)) throw new ExecutionError("材料种类只能是面料、纱线或辅料");
  const composition = input.composition?.trim() || "";
  const gsm = input.gsm?.trim() || "";
  const widthCm = input.widthCm?.trim() || "";
  if (gsm && !/^\d+(\.\d{1,2})?$/.test(gsm)) throw new ExecutionError("克重须为正数");
  if (widthCm && !/^\d+(\.\d{1,2})?$/.test(widthCm)) throw new ExecutionError("幅宽须为正数");
  const specSummary = buildSpecSummary({
    composition,
    gsm,
    widthCm,
    specSummary: input.specSummary,
  });
  const unit = input.unit?.trim() || "m";
  const exists = await prisma.material.findFirst({
    where: { organizationId: input.organizationId, code },
  });
  if (exists) throw new ExecutionError("货号已存在");

  const material = await prisma.material.create({
    data: {
      id: createId(),
      organizationId: input.organizationId,
      code,
      name,
      kind,
      specSummary,
      unit,
        demoNote: "人手建档，不是库存，也不是已采购",
    },
  });
  await writeMaterialCard(material.id, {
    composition,
    gsm,
    widthCm,
    createdByUserId: input.userId,
    createdAt: new Date().toISOString(),
    imagePath: "",
  });
  const message = `已建材料 ${code}，这是主档不是库存，也不是已采购`;
  await writeAudit({
    organizationId: input.organizationId,
    actorUserId: input.userId,
    action: "material.master.created",
    entityType: "Material",
    entityId: material.id,
    summary: message,
    payloadJson: JSON.stringify({ actionType: ACTION_TYPES.createMaterialMaster, code, kind }),
  });
  return { materialId: material.id, materialCode: material.code, message };
}

export async function updateMaterialCard(input: {
  organizationId: string;
  userId: string;
  role: string;
  materialId: string;
  specSummary?: string;
  composition?: string;
  gsm?: string;
  widthCm?: string;
}) {
  if (!canApproveAction(input.role, ACTION_TYPES.createMaterialMaster)) {
    throw new ExecutionError("无权改材料主档");
  }
  const material = await prisma.material.findFirst({
    where: { id: input.materialId, organizationId: input.organizationId },
  });
  if (!material) throw new ExecutionError("材料不存在或不属于当前组织");
  const composition = input.composition?.trim() ?? "";
  const gsm = input.gsm?.trim() ?? "";
  const widthCm = input.widthCm?.trim() ?? "";
  if (gsm && !/^\d+(\.\d{1,2})?$/.test(gsm)) throw new ExecutionError("克重须为正数");
  if (widthCm && !/^\d+(\.\d{1,2})?$/.test(widthCm)) throw new ExecutionError("幅宽须为正数");
  const specSummary = buildSpecSummary({
    composition,
    gsm,
    widthCm,
    specSummary: input.specSummary,
  });
  await prisma.material.update({
    where: { id: material.id },
    data: { specSummary },
  });
  await writeMaterialCard(material.id, { composition, gsm, widthCm });
  const message = `已更新材料 ${material.code} 主档卡片，不是库存`;
  await writeAudit({
    organizationId: input.organizationId,
    actorUserId: input.userId,
    action: "material.card.updated",
    entityType: "Material",
    entityId: material.id,
    summary: message,
    payloadJson: JSON.stringify({ actionType: ACTION_TYPES.createMaterialMaster, composition, gsm, widthCm }),
  });
  return { materialId: material.id, materialCode: material.code, message };
}
