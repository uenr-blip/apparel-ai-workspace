import { lockOrganizationForWrite } from "./order-write";
import { ACTION_TYPES } from "@/lib/constants";
import { prisma } from "@/lib/db";
import { createId, sha256Bytes } from "@/lib/hash";
import { styleImageSrc } from "@/lib/style-image";
import { canApproveAction } from "@/server/permissions";
import { ExecutionError } from "@/server/services/execution";
import { putPrivateFile, deletePrivateFile } from "@/server/storage/local";
import { writeConstruction, parseConstruction, type ConstructionUpload } from "./style-construction";
import { writeAudit } from "@/server/services/intake";
import { categoryOptionLabel, resolveStyleOption } from "@/server/services/style-catalog";

export const STYLE_IMAGE_MAX_BYTES = 5 * 1024 * 1024;

function sniffImage(bytes: Buffer) {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return { ext: "png" as const, mime: "image/png" as const };
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { ext: "jpg" as const, mime: "image/jpeg" as const };
  }
  return null;
}

export async function createStyleMaster(input: {
  organizationId: string;
  userId: string;
  role: string;
  code: string;
  name: string;
  category?: string;
  silhouette?: string;
  designerId?: string | null;
  brandOptionId?: string | null;
  categoryOptionId?: string | null;
  typeOptionId?: string | null;
  yearOptionId?: string | null;
  seasonId?: string | null;
  bytes?: Buffer;
  filename?: string;
  construction?: unknown;
  constructionUploads?: ConstructionUpload[];
}) {
  if (!canApproveAction(input.role, ACTION_TYPES.createStyleMaster)) {
    throw new ExecutionError("无权新建款式主档");
  }
  const code = input.code.trim();
  const construction = parseConstruction(input.construction ?? []);
  const writtenFiles: string[] = [];
  const name = input.name.trim();
  if (!code || !name) throw new ExecutionError("请填写款号和款名");
  let category = input.category?.trim() || "未填写";
  const silhouette = input.silhouette?.trim() || "未填写";
  let brandOptionId: string | null = null;
  let categoryOptionId: string | null = null;
  let typeOptionId: string | null = null;
  let yearOptionId: string | null = null;
  if (input.brandOptionId) {
    brandOptionId = (
      await resolveStyleOption({
        organizationId: input.organizationId,
        optionId: input.brandOptionId,
        kind: "brand",
      })
    ).id;
  }
  if (input.categoryOptionId) {
    const categoryOption = await resolveStyleOption({
      organizationId: input.organizationId,
      optionId: input.categoryOptionId,
      kind: "category",
    });
    categoryOptionId = categoryOption.id;
    category = categoryOptionLabel(categoryOption);
  }
  if (input.typeOptionId) {
    typeOptionId = (
      await resolveStyleOption({
        organizationId: input.organizationId,
        optionId: input.typeOptionId,
        kind: "type",
      })
    ).id;
  }
  if (input.yearOptionId) {
    yearOptionId = (
      await resolveStyleOption({
        organizationId: input.organizationId,
        optionId: input.yearOptionId,
        kind: "year",
      })
    ).id;
  }

  const exists = await prisma.style.findFirst({
    where: { organizationId: input.organizationId, code },
  });
  if (exists || await prisma.styleCodeAlias.findFirst({ where: { organizationId: input.organizationId, code } })) throw new ExecutionError("款号已存在或是已有款式的旧款号，请打开原款");
  let designerId: string | null = null;
  if (input.designerId) {
    const designer = await prisma.designer.findFirst({
      where: { id: input.designerId, organizationId: input.organizationId },
    });
    if (!designer) throw new ExecutionError("设计师不存在或不属于当前组织");
    designerId = designer.id;
  }

  let imagePath = "/styles/_template.svg";
  if (input.bytes?.length) {
    if (input.bytes.length > STYLE_IMAGE_MAX_BYTES) throw new ExecutionError("图片超过 5MB");
    const kind = sniffImage(input.bytes);
    if (!kind) throw new ExecutionError("只接受 JPG 或 PNG，未进行识款");
    const stamp = sha256Bytes(input.bytes).slice(0, 16);
    imagePath = `styles/${input.organizationId}/${createId()}-${stamp}.${kind.ext}`;
    await putPrivateFile(imagePath, input.bytes);
    writtenFiles.push(imagePath);
  }

  const styleId = createId();
  const versionId = createId();
  const message = `已建款号 ${code}，资料未齐，未识款，不能投产`;
  try { await prisma.$transaction(async (tx) => {
    await lockOrganizationForWrite(tx, input.organizationId);
    if (!await tx.user.findFirst({ where: { id: input.userId, organizationId: input.organizationId, role: input.role, active: true } })) throw new ExecutionError("当前账号无权新建款式");
    const seasonId = input.seasonId || null;
    if (seasonId && !await tx.season.findFirst({ where: { id: seasonId, organizationId: input.organizationId } })) throw new ExecutionError("季节不存在或不属于当前组织");
    if (await tx.style.findFirst({ where: { organizationId: input.organizationId, code } }) || await tx.styleCodeAlias.findFirst({ where: { organizationId: input.organizationId, code } })) throw new ExecutionError("款号已存在或是已有款式的旧款号，请打开原款");
    await tx.style.create({
      data: {
        id: styleId,
        organizationId: input.organizationId,
        code,
        name,
        category,
        silhouette,
        status: "draft",
        imagePath,
        demoNote: "人手建档，资料未齐，不能投产",
        designerId,
        createdByUserId: input.userId,
        brandOptionId,
        categoryOptionId,
        typeOptionId,
        yearOptionId,
      },
    });
    await tx.styleVersion.create({
      data: {
        id: versionId,
        styleId,
        versionNumber: 1,
        status: "draft",
        cuffType: "未填写",
        changeSummary: "新建主档，资料未齐，不能投产",
        specNotes: "",
        processNotes: "",
        patternRevision: "",
      },
    });
    if (seasonId) await tx.styleSeason.create({ data: { id: createId(), styleId, seasonId } });
    const constructionAfter = await writeConstruction(tx, { organizationId: input.organizationId, userId: input.userId, versionId, rows: construction, previous: [], uploads: input.constructionUploads, writtenFiles });
  await writeAudit({
    organizationId: input.organizationId,
    actorUserId: input.userId,
    action: "style.master.created",
    entityType: "Style",
    entityId: styleId,
    summary: message,
    payloadJson: JSON.stringify({
      actionType: ACTION_TYPES.createStyleMaster,
      code,
      recognized: false,
      before: null, after: { styleId, code, name, imagePath, designerId, brandOptionId, categoryOptionId, typeOptionId, yearOptionId, seasonId, versionId, construction: constructionAfter },
    }),
  }, tx);
  }, { timeout: 30000 }); } catch (error) {
    await Promise.all(writtenFiles.map(p => deletePrivateFile(p).catch(() => undefined)));
    throw error;
  }

  return {
    styleId,
    styleCode: code,
    versionId,
    recognized: false as const,
    imageSrc: styleImageSrc({ id: styleId, imagePath }),
    message,
  };
}
