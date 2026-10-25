import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { createId, sha256 } from "@/lib/hash";
import { ACTION_TYPES } from "@/lib/constants";
import { ConstructionInput, constructionKind, readConstruction, type StoredConstructionItem } from "@/lib/style-construction";
import { canApproveAction } from "@/server/permissions";
import { putPrivateFile, deletePrivateFile, readPrivateFile } from "@/server/storage/local";
import { lockOrganizationForWrite } from "./order-write";
import { ExecutionError } from "./execution";
import { parseConsumptionInput } from "./style-bom";
import { writeAudit } from "./intake";

const versionInclude = { bomLines: { include: { material: true }, orderBy: { materialId: "asc" as const } }, attachments: true };
type Version = Prisma.StyleVersionGetPayload<{ include: typeof versionInclude }>;
export type ConstructionUpload = { key: string; bytes: Buffer; name: string };
export function constructionRows(version: Version | undefined | null): StoredConstructionItem[] {
  if (!version) return [];
  const saved = readConstruction(version.constructionJson);
  const rows = saved.filter(r => r.group === "process" || version.bomLines.some(b => b.materialId === r.materialId)).map(r => {
    const bom = version.bomLines.find(b => b.materialId === r.materialId);
    return bom ? { ...r, fields: { ...r.fields, consumption: bom.consumption === "pending" ? "" : bom.consumption, unit: bom.unit } } : r;
  });
  for (const b of version.bomLines) {
    if (rows.some(r => r.materialId === b.materialId)) continue;
    rows.push({ key: `material-${b.materialId}`, group: b.material.kind === "fabric" || b.material.kind === "yarn" ? b.material.kind : "regularTrim", name: b.material.name, materialId: b.materialId, useMaterialImage: Boolean(b.material.imagePath && !b.material.imagePath.startsWith("/") && /\.(png|jpe?g)$/i.test(b.material.imagePath)),
      fields: { composition: b.material.composition, specification: b.material.specSummary, gsm: b.material.gsm, width: b.material.widthCm, consumption: b.consumption === "pending" ? "" : b.consumption, unit: b.unit } });
  }
  return rows;
}
export function constructionStamp(version: Version | undefined | null) {
  return sha256(JSON.stringify(version ? { id: version.id, status: version.status, content: version.constructionJson, bom: version.bomLines, process: version.processNotes, spec: version.specNotes, pattern: version.patternRevision, attachments: version.attachments } : null));
}
export function parseConstruction(raw: unknown) {
  const parsed = ConstructionInput.safeParse(raw);
  if (!parsed.success) throw new ExecutionError(parsed.error.issues[0]?.message || "用料与工艺格式不正确");
  return parsed.data;
}
function identity(row: StoredConstructionItem) {
  return JSON.stringify([row.group, row.name, ...["composition", "specification", "gsm", "width", "yarnCount", "size", "unit"].map(k => row.fields[k as keyof typeof row.fields] || "")]);
}

// Called inside the same transaction as the master/version write. Files are tracked for rollback.
export async function writeConstruction(db: Prisma.TransactionClient, input: {
  organizationId: string; userId: string; versionId?: string; stageId?: string; rows: unknown; previous: StoredConstructionItem[]; uploads?: ConstructionUpload[]; writtenFiles: string[];
}) {
  const rows = parseConstruction(input.rows);
  const uploads = input.uploads ?? [];
  if (uploads.length > 60 || uploads.reduce((n, f) => n + f.bytes.length, 0) > 20 * 1024 * 1024) throw new ExecutionError("项目图片合计不能超过 20MB");
  if (new Set(uploads.map(f => f.key)).size !== uploads.length || uploads.some(f => !rows.some(r => r.key === f.key))) throw new ExecutionError("图片与项目不匹配");
  const beforeBom = input.versionId ? await db.bomLine.findMany({ where: { styleVersionId: input.versionId } }) : [];
  const result: StoredConstructionItem[] = [];
  const used = new Set<string>();
  for (const row of rows) {
    const old = input.previous.find(r => r.key === row.key);
    if (row.imageId && row.imageId !== old?.image?.id) throw new ExecutionError("图片依据已变化，请刷新核对");
    const entry: StoredConstructionItem = { ...row, image: row.imageId ? old?.image : undefined };
    const upload = uploads.find(f => f.key === row.key);
    if (upload) {
      if (!upload.bytes.length || upload.bytes.length > 5 * 1024 * 1024) throw new ExecutionError("每张项目图片不能超过 5MB");
      const png = upload.bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
      const jpg = upload.bytes.length > 3 && upload.bytes[0] === 255 && upload.bytes[1] === 216 && upload.bytes[2] === 255;
      if (!png && !jpg) throw new ExecutionError("项目图片只接受 JPG / PNG");
      const id = createId(), path = `construction/${input.organizationId}/${id}.${png ? "png" : "jpg"}`;
      await putPrivateFile(path, upload.bytes); input.writtenFiles.push(path);
      entry.image = { id, path, name: upload.name.slice(0, 200), mime: png ? "image/png" : "image/jpeg" };
    }
    entry.imageId = entry.image?.id;
    if (row.group !== "process") {
      const unit = row.fields.unit || (row.group === "fabric" ? "m" : row.group === "yarn" ? "kg" : "pcs");
      const consumption = parseConsumptionInput(row.fields.consumption);
      let material = row.materialId ? await db.material.findFirst({ where: { id: row.materialId, organizationId: input.organizationId } }) : null;
      if (row.materialId && (!material || (material.archivedAt && old?.materialId !== row.materialId))) throw new ExecutionError("所选材料不可用，请重新选择");
      if (material && material.kind !== constructionKind(row.group)) throw new ExecutionError("材料种类与项目不一致");
      if (material && row.useMaterialImage && !upload && !row.imageId && material.imagePath) {
        if (material.imagePath.startsWith("/") || !/\.(png|jpe?g)$/i.test(material.imagePath)) throw new ExecutionError("这份材料示意图请在资料中另附 JPG / PNG 图片");
        const bytes = await readPrivateFile(material.imagePath);
        const png = bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
        const jpg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
        if ((!png && !jpg) || bytes.length > 5 * 1024 * 1024) throw new ExecutionError("材料图片无效，请重新上传");
        const id = createId(), path = `construction/${input.organizationId}/${id}.${png ? "png" : "jpg"}`;
        await putPrivateFile(path, bytes); input.writtenFiles.push(path);
        entry.image = { id, path, name: `${material.name}参考图`, mime: png ? "image/png" : "image/jpeg" }; entry.imageId = id;
      }
      delete entry.useMaterialImage;
      const selectedMaterialChanged = material && old?.materialId !== material.id && (
        material.name !== row.name || material.unit !== unit || material.composition !== (row.fields.composition || "") ||
        material.gsm !== (row.fields.gsm || "") || material.widthCm !== (row.fields.width || "") ||
        material.specSummary !== [row.fields.specification, row.fields.yarnCount, row.fields.size].filter(Boolean).join(" · ")
      );
      if (!material || selectedMaterialChanged || (old?.materialId === material.id && identity(old) !== identity(row))) {
        const id = createId();
        material = await db.material.create({ data: { id, organizationId: input.organizationId, code: `MAT-${id}`, name: row.name, kind: constructionKind(row.group), unit,
          composition: row.fields.composition || "", gsm: row.fields.gsm || "", widthCm: row.fields.width || "", specSummary: [row.fields.specification, row.fields.yarnCount, row.fields.size].filter(Boolean).join(" · "),
          imagePath: entry.image?.path || "", createdByUserId: input.userId, createdAt: new Date().toISOString(), demoNote: "款式用料建档，待核对；不是库存或采购" } });
        await writeAudit({ organizationId: input.organizationId, actorUserId: input.userId, action: "material.master.created", entityType: "Material", entityId: material.id, summary: `由业务资料建档材料 ${row.name}`, payloadJson: JSON.stringify({ before: null, after: material, basis: { versionId: input.versionId, stageId: input.stageId, itemKey: row.key, replacesMaterialId: old?.materialId ?? null } }) }, db);
      }
      if (used.has(material.id)) throw new ExecutionError("同一材料请合并为一项，在使用部位注明各部位");
      used.add(material.id); entry.materialId = material.id; entry.fields.unit = unit;
      const prior = beforeBom.find(b => b.materialId === material.id);
      if (input.versionId) await db.bomLine.create({ data: { id: createId(), styleVersionId: input.versionId, materialId: material.id, consumption, unit,
        confirmed: false, includesAllowance: prior?.includesAllowance ?? false, allowanceRate: prior?.allowanceRate ?? "0.03", colorScope: prior?.colorScope ?? "all" } });
    } else {
      if (row.materialId) throw new ExecutionError("特殊工艺不能作为材料引用");
      delete entry.materialId;
    }
    result.push(entry);
  }
  if (input.versionId) {
    await db.bomLine.deleteMany({ where: { id: { in: beforeBom.map(b => b.id) } } });
    await db.styleVersion.update({ where: { id: input.versionId }, data: { constructionJson: JSON.stringify(result) } });
  }
  return result;
}

export async function saveStyleConstruction(input: { organizationId: string; userId: string; role: string; styleId: string; expectedStamp: string; rows: unknown; uploads?: ConstructionUpload[] }) {
  if (!canApproveAction(input.role, ACTION_TYPES.saveStyleBomDraft) || !canApproveAction(input.role, ACTION_TYPES.saveStyleProcessDraft)) throw new ExecutionError("无权修改款式用料与工艺");
  const writtenFiles: string[] = [];
  try {
    return await prisma.$transaction(async db => {
      await lockOrganizationForWrite(db, input.organizationId);
      if (!await db.user.findFirst({ where: { id: input.userId, organizationId: input.organizationId, role: input.role, active: true } })) throw new ExecutionError("当前账号无权修改资料");
      const style = await db.style.findFirst({ where: { id: input.styleId, organizationId: input.organizationId, archivedAt: null }, include: { versions: { orderBy: { versionNumber: "desc" }, include: versionInclude } } });
      if (!style) throw new ExecutionError("款式不存在或已归档");
      const source = style.versions.find(v => v.status !== "approved") ?? style.versions[0];
      if (constructionStamp(source) !== input.expectedStamp) throw new ExecutionError("资料已被修改，请刷新后重新核对，当前填写尚未保存");
      const previous = constructionRows(source);
      let target = source;
      const createdDraft = !target || target.status === "approved";
      if (createdDraft) {
        target = await db.styleVersion.create({ data: { id: createId(), styleId: style.id, versionNumber: (style.versions[0]?.versionNumber ?? 0) + 1, status: "draft", cuffType: source?.cuffType ?? "未填写", specNotes: source?.specNotes ?? "", processNotes: source?.processNotes ?? "", patternRevision: source?.patternRevision ?? "", sourceDocumentId: source?.sourceDocumentId, changeSummary: "用料与特殊工艺修订，待重新核对" }, include: versionInclude });
        if (source?.bomLines.length) await db.bomLine.createMany({ data: source.bomLines.map(b => ({ id: createId(), styleVersionId: target.id, materialId: b.materialId, consumption: b.consumption, unit: b.unit, includesAllowance: b.includesAllowance, allowanceRate: b.allowanceRate, colorScope: b.colorScope, confirmed: false })) });
        if (source?.attachments.length) await db.styleVersionAttachment.createMany({ data: source.attachments.map(a => ({ ...a, id: createId(), styleVersionId: target.id })) });
      }
      const after = await writeConstruction(db, { ...input, versionId: target.id, previous, writtenFiles });
      await writeAudit({ organizationId: input.organizationId, actorUserId: input.userId, action: "style.construction.saved", entityType: "StyleVersion", entityId: target.id, summary: `保存 V${target.versionNumber} 用料与特殊工艺草稿`, payloadJson: JSON.stringify({ before: previous, after, basis: { styleId: style.id, sourceVersionId: source?.id, expectedStamp: input.expectedStamp }, createdDraft }) }, db);
      return { versionId: target.id, message: `已保存 V${target.versionNumber} 草稿，用料与工艺待核对。` };
    }, { timeout: 30000 });
  } catch (error) { await Promise.all(writtenFiles.map(p => deletePrivateFile(p).catch(() => undefined))); throw error; }
}

export async function readConstructionImage(input: { organizationId: string; userId: string; role: string; factoryId?: string | null; styleId: string; versionId: string; key: string }) {
  if (!await prisma.user.findFirst({ where: { id: input.userId, organizationId: input.organizationId, role: input.role, active: true } })) throw new ExecutionError("无权读取图片");
  const version = await prisma.styleVersion.findFirst({ where: { id: input.versionId, styleId: input.styleId, style: { organizationId: input.organizationId } } });
  if (!version) throw new ExecutionError("资料不存在");
  if (input.role === "factory" && (!input.factoryId || !await prisma.orderLine.findFirst({ where: { styleVersionId: version.id, order: { organizationId: input.organizationId, factoryId: input.factoryId } } }))) throw new ExecutionError("无权读取该版图片");
  const image = readConstruction(version.constructionJson).find(r => r.key === input.key)?.image;
  if (!image) throw new ExecutionError("图片不存在");
  return { ...image, bytes: await readPrivateFile(image.path) };
}
