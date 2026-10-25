import { resolveContext } from "@/server/context/context-service";
import { ACTION_TYPES } from "@/lib/constants";
import { prisma } from "@/lib/db";
import { createId, sha256, sha256Bytes } from "@/lib/hash";
import { imageConfigStatus, imageLiveConfigured } from "@/lib/ai-config";
import { canApproveAction } from "@/server/permissions";
import { generateLiveDesignImages, ImageModelError, type DesignImageProvider } from "@/server/ai/image";
import { writeAudit } from "@/server/services/intake";
import { ExecutionError } from "@/server/services/execution";
import { readMaterialImage } from "@/server/services/material-image";
import { readStyleImage, styleImageSrc } from "@/server/services/style-image";
import { putPrivateFile, readPrivateFile } from "@/server/storage/local";

export const DESIGN_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
const SLOTS = ["A", "B", "C", "D"] as const;

export class DesignStudioError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DesignStudioError";
  }
}

export const DESIGN_INTENTS = ["reference", "recolor", "edit", "onbody"] as const;
export type DesignIntent = (typeof DESIGN_INTENTS)[number];

type Actor = {
  organizationId: string;
  userId: string;
  role: string;
};

async function assertDraft(actor: Actor, actionType: string) {
  const current = await prisma.user.findFirst({ where: { id: actor.userId, organizationId: actor.organizationId, active: true, role: actor.role } });
  if (!current) throw new DesignStudioError("当前账号无权使用此设计工作台");
  if (!canApproveAction(actor.role, actionType)) {
    throw new DesignStudioError("当前角色不能使用 AI 设计工作台");
  }
}

function sniffImage(bytes: Buffer) {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return { ext: "png" as const, mime: "image/png" as const };
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { ext: "jpg" as const, mime: "image/jpeg" as const };
  }
  return null;
}

function asError(error: unknown, fallback: string) {
  if (error instanceof DesignStudioError || error instanceof ExecutionError || error instanceof ImageModelError) {
    return error;
  }
  return new DesignStudioError(error instanceof Error ? error.message : fallback);
}

async function nextDesignCode(organizationId: string) {
  const count = await prisma.designProject.count({ where: { organizationId } });
  return `DES-${String(count + 1).padStart(3, "0")}`;
}

async function storeImage(organizationId: string, bytes: Buffer, mimeHint?: string) {
  if (bytes.length > DESIGN_IMAGE_MAX_BYTES) throw new DesignStudioError("图片超过 5MB");
  const kind = sniffImage(bytes);
  if (!kind) throw new DesignStudioError("只接受 JPG 或 PNG");
  if (mimeHint && mimeHint !== kind.mime && !mimeHint.startsWith("image/")) {
    throw new DesignStudioError("只接受 JPG 或 PNG");
  }
  const relative = `design/${organizationId}/${createId()}-${sha256Bytes(bytes).slice(0, 16)}.${kind.ext}`;
  await putPrivateFile(relative, bytes);
  return { path: relative, mime: kind.mime };
}

export function designAssetSrc(assetId: string, imagePath: string) {
  const stamp = imagePath.split("/").pop()?.replace(/\.[^.]+$/, "").split("-").pop() ?? "v";
  return `/api/design/assets/${assetId}/image?v=${stamp}`;
}

export function designVariantSrc(variantId: string, imagePath: string) {
  const stamp = imagePath.split("/").pop()?.replace(/\.[^.]+$/, "").split("-").pop() ?? "v";
  return `/api/design/variants/${variantId}/image?v=${stamp}`;
}

export async function createDesignProject(input: Actor & {
  name: string;
  brief?: string;
  intent?: string;
  styleId?: string | null;
  materialId?: string | null;
}) {
  await assertDraft(input, ACTION_TYPES.createDesignProject);
  const name = input.name.trim();
  if (!name) throw new DesignStudioError("请填写草案名称，不需要正式款号");
  const requestedIntent = input.intent ?? "reference";
  const intent = DESIGN_INTENTS.includes(requestedIntent as DesignIntent)
    ? (requestedIntent as DesignIntent)
    : "reference";

  const style = input.styleId
    ? await prisma.style.findFirst({ where: { id: input.styleId, organizationId: input.organizationId } })
    : null;
  if (input.styleId && !style) throw new DesignStudioError("款式不存在或不属于当前组织");
  const material = input.materialId
    ? await prisma.material.findFirst({ where: { id: input.materialId, organizationId: input.organizationId } })
    : null;
  if (input.materialId && !material) throw new DesignStudioError("材料不存在或不属于当前组织");

  const project = await prisma.designProject.create({
    data: {
      id: createId(),
      organizationId: input.organizationId,
      code: await nextDesignCode(input.organizationId),
      name,
      brief: (input.brief ?? "").trim(),
      intent,
      status: "open",
      styleId: style?.id ?? null,
      materialId: material?.id ?? null,
      createdByUserId: input.userId,
    },
  });

  if (style) {
    try {
      const image = await readStyleImage({ organizationId: input.organizationId, styleId: style.id });
      if (sniffImage(image.bytes)) {
        const stored = await storeImage(input.organizationId, image.bytes, image.mime);
        await prisma.designAsset.create({
          data: {
            id: createId(),
            projectId: project.id,
            kind: "style",
            label: `${style.code} 款图`,
            imagePath: stored.path,
            mimeType: stored.mime,
            note: "引用已有款式图，不是新主档",
          },
        });
      }
    } catch {
      // 公共示意 SVG 不能当生成参考，跳过
    }
  }
  if (material) {
    try {
      const image = await readMaterialImage({ organizationId: input.organizationId, materialId: material.id });
      if (image.bytes && sniffImage(image.bytes)) {
        const stored = await storeImage(input.organizationId, image.bytes, image.mime);
        await prisma.designAsset.create({
          data: {
            id: createId(),
            projectId: project.id,
            kind: "material",
            label: `${material.code} 色卡`,
            imagePath: stored.path,
            mimeType: stored.mime,
            note: "引用已有材料图，不是采购",
          },
        });
      }
    } catch {
      // 无色卡图则只挂材料关系
    }
  }

  await writeAudit({
    organizationId: input.organizationId,
    actorUserId: input.userId,
    action: "design.project.created",
    entityType: "DesignProject",
    entityId: project.id,
    summary: `已开设计草案 ${project.code}，非正式款号`,
  });
  return getDesignProject(input.organizationId, project.id);
}

export async function listDesignProjects(organizationId: string) {
  const rows = await prisma.designProject.findMany({
    where: { organizationId },
    include: {
      style: true,
      material: true,
      development: true,
      assets: true,
      rounds: { include: { variants: true }, orderBy: { versionNumber: "desc" } },
    },
    orderBy: { updatedAt: "desc" },
  });
  return rows.map((row) => summarizeProject(row));
}

export async function getDesignProject(organizationId: string, projectId: string) {
  const project = await prisma.designProject.findFirst({
    where: { id: projectId, organizationId },
    include: {
      style: true,
      material: true,
      development: true,
      assets: { orderBy: { createdAt: "asc" } },
      rounds: { include: { variants: { orderBy: { createdAt: "asc" } } }, orderBy: { versionNumber: "desc" } },
    },
  });
  if (!project) throw new DesignStudioError("设计草案不存在或不属于当前组织");
  return {
    ...summarizeProject(project),
    imageStatus: imageConfigStatus(),
    styleImageSrc: project.style ? styleImageSrc(project.style) : "",
    assets: project.assets.map((asset) => ({
      id: asset.id,
      kind: asset.kind,
      label: asset.label,
      note: asset.note,
      imageSrc: designAssetSrc(asset.id, asset.imagePath),
    })),
    rounds: project.rounds.map((round) => ({
      id: round.id,
      versionNumber: round.versionNumber,
      kind: round.kind,
      intent: round.intent,
      prompt: round.prompt,
      instruction: round.instruction,
      mode: round.mode,
      provider: round.provider,
      model: round.model,
      status: round.status,
      errorMessage: round.errorMessage,
      createdAt: round.createdAt.toISOString(),
      variants: round.variants.map((variant) => ({
        id: variant.id,
        slot: variant.slot,
        label: variant.label,
        selected: variant.selected,
        origin: variant.origin,
        prompt: variant.prompt,
        imageSrc: designVariantSrc(variant.id, variant.imagePath),
      })),
    })),
  };
}

function summarizeProject(project: {
  id: string;
  code: string;
  name: string;
  brief: string;
  intent: string;
  status: string;
  styleId: string | null;
  materialId: string | null;
  developmentProjectId: string | null;
  style: { id: string; code: string; name: string } | null;
  material: { id: string; code: string; name: string } | null;
  development: { id: string; code: string; name: string } | null;
  rounds: Array<{ variants: Array<{ id: string; selected: boolean; imagePath: string }> }>;
  assets: Array<{ id: string; imagePath: string }>;
}) {
  const chosen =
    project.rounds.flatMap((round) => round.variants).find((item) => item.selected) ??
    project.rounds[0]?.variants[0];
  const cover = chosen
    ? designVariantSrc(chosen.id, chosen.imagePath)
    : project.assets[0]
      ? designAssetSrc(project.assets[0].id, project.assets[0].imagePath)
      : "";
  return {
    id: project.id,
    code: project.code,
    name: project.name,
    brief: project.brief,
    intent: project.intent,
    status: project.status,
    styleId: project.styleId,
    materialId: project.materialId,
    developmentProjectId: project.developmentProjectId,
    styleCode: project.style?.code ?? null,
    styleName: project.style?.name ?? null,
    materialCode: project.material?.code ?? null,
    materialName: project.material?.name ?? null,
    developmentCode: project.development?.code ?? null,
    href: `/styles/design/${project.id}`,
    coverSrc: cover,
    assetCount: project.assets.length,
    variantCount: project.rounds.reduce((sum, round) => sum + round.variants.length, 0),
  };
}

export async function attachDesignAsset(input: Actor & {
  projectId: string;
  bytes: Buffer;
  label?: string;
  note?: string;
}) {
  await assertDraft(input, ACTION_TYPES.createDesignProject);
  const project = await prisma.designProject.findFirst({
    where: { id: input.projectId, organizationId: input.organizationId },
  });
  if (!project) throw new DesignStudioError("设计草案不存在或不属于当前组织");
  if (project.status === "adopted") throw new DesignStudioError("已转入开发，不能再改这份草案的参考");
  const stored = await storeImage(input.organizationId, input.bytes);
  const asset = await prisma.designAsset.create({
    data: {
      id: createId(),
      projectId: project.id,
      kind: "upload",
      label: (input.label ?? "参考图").trim() || "参考图",
      imagePath: stored.path,
      mimeType: stored.mime,
      note: (input.note ?? "").trim(),
    },
  });
  await writeAudit({
    organizationId: input.organizationId,
    actorUserId: input.userId,
    action: "design.asset.attached",
    entityType: "DesignProject",
    entityId: project.id,
    summary: `草案 ${project.code} 增加参考图`,
  });
  return { assetId: asset.id, imageSrc: designAssetSrc(asset.id, asset.imagePath) };
}

export async function bindDesignStyle(input: Actor & { projectId: string; styleId: string }) {
  await assertDraft(input, ACTION_TYPES.createDesignProject);
  const project = await prisma.designProject.findFirst({
    where: { id: input.projectId, organizationId: input.organizationId },
  });
  if (!project) throw new DesignStudioError("设计草案不存在或不属于当前组织");
  if (project.status === "adopted") throw new DesignStudioError("已转入开发，不能再改参考");
  const style = await prisma.style.findFirst({
    where: { id: input.styleId, organizationId: input.organizationId },
  });
  if (!style) throw new DesignStudioError("款式不存在或不属于当前组织");
  await prisma.designProject.update({
    where: { id: project.id },
    data: { styleId: style.id },
  });
  return getDesignProject(input.organizationId, project.id);
}

async function loadProject(organizationId: string, projectId: string) {
  const project = await prisma.designProject.findFirst({
    where: { id: projectId, organizationId },
    include: {
      assets: true,
      rounds: { include: { variants: true }, orderBy: { versionNumber: "desc" } },
    },
  });
  if (!project) throw new DesignStudioError("设计草案不存在或不属于当前组织");
  if (project.status === "adopted") throw new DesignStudioError("已转入开发，不能再生成");
  return project;
}

async function collectReferences(project: {
  organizationId: string;
  assets: Array<{ imagePath: string; mimeType: string }>;
  rounds: Array<{ variants: Array<{ selected: boolean; imagePath: string; mimeType: string }> }>;
}) {
  const refs: Array<{ bytes: Buffer; mime: string }> = [];
  for (const asset of project.assets) {
    refs.push({ bytes: await readPrivateFile(asset.imagePath), mime: asset.mimeType });
  }
  const selected = project.rounds.flatMap((round) => round.variants.filter((item) => item.selected));
  for (const variant of selected) {
    refs.push({ bytes: await readPrivateFile(variant.imagePath), mime: variant.mimeType });
  }
  return refs;
}

const activeGenerations = new Set<string>();
export async function generateDesignRound(input: Actor & {
  projectId: string;
  prompt: string;
  instruction?: string;
  intent?: string;
  count?: number;
  provider?: DesignImageProvider;
}) {
  await assertDraft(input, ACTION_TYPES.generateDesignImage);
  const lockKey = `${input.organizationId}:${input.projectId}`;
  if (activeGenerations.has(lockKey)) throw new DesignStudioError("这份草案正在生成，请等待结果后再操作");
  activeGenerations.add(lockKey);
  try {
  const prompt = input.prompt.trim();
  if (!prompt) throw new DesignStudioError("请写下要求和参考说明");
  const project = await loadProject(input.organizationId, input.projectId);
  if (project.status !== "open") throw new DesignStudioError("已采用的草案不能继续生成，请从业务资料建立新草案");
  const context = await resolveContext({ ...input, factoryId: null }, "design");
  const requestedIntent = input.intent ?? project.intent;
  const intent = DESIGN_INTENTS.includes(requestedIntent as DesignIntent)
    ? (requestedIntent as DesignIntent)
    : project.intent;
  const count = Math.min(Math.max(input.count ?? 2, 1), 4);
  const provider = input.provider ?? generateLiveDesignImages;
  if (!input.provider && !imageLiveConfigured()) {
    throw new DesignStudioError(imageConfigStatus().message);
  }

  const references = await collectReferences(project);
  if (intent !== "reference" && !references.length) throw new DesignStudioError("请先上传参考图或选定已有方案，再做定向修改、改色或上身");
  const source = await prisma.sourceDocument.create({
    data: {
      id: createId(),
      organizationId: input.organizationId,
      contentHash: sha256(`${project.id}:${prompt}:${Date.now()}:${createId()}`),
      origin: "design_studio",
      filename: `${project.code}-generate.txt`,
      mimeType: "text/plain",
      rawText: prompt,
      receivedAt: new Date(),
      parseStatus: "queued",
    },
  });
  const job = await prisma.aiJob.create({
    data: {
      id: createId(),
      organizationId: input.organizationId,
      sourceDocumentId: source.id,
      mode: "live",
      provider: "image",
      status: "running",
    },
  });

  try {
    const generated = await provider({
      prompt,
      instruction: [input.instruction, context.instructions].filter(Boolean).join("\n"),
      intent,
      count,
      references,
    });
    if (!generated.images.length) throw new DesignStudioError("图像模型没有返回可用图片");
    await assertDraft(input, ACTION_TYPES.generateDesignImage);
    const versionNumber = (project.rounds[0]?.versionNumber ?? 0) + 1;
    const roundId = createId();
    const variantRows: Array<{ id: string; slot: string; label: string; imagePath: string; mimeType: string; prompt: string; selected: boolean; origin: string }> = [];
    for (const [index, image] of generated.images.slice(0, count).entries()) {
      const stored = await storeImage(input.organizationId, image.bytes, image.mime);
      variantRows.push({
        id: createId(),
        slot: SLOTS[index] ?? String(index + 1),
        label: image.label || `方案 ${SLOTS[index] ?? index + 1}`,
        imagePath: stored.path,
        mimeType: stored.mime,
        prompt,
        selected: false,
        origin: "generated",
      });
    }
    await prisma.$transaction(async tx => {
      await tx.$executeRaw`UPDATE DesignProject SET name=name WHERE id=${project.id}`;
      const current = await tx.designProject.findFirstOrThrow({ where: { id: project.id, organizationId: input.organizationId }, include: { rounds: { select: { id: true } } } });
      if (current.status !== "open" || current.rounds.length !== project.rounds.length) throw new DesignStudioError("草案已发生变化，本次结果未覆盖现有内容，请核对后再操作");
    await tx.designRound.create({
      data: {
        id: roundId,
        projectId: project.id,
        versionNumber,
        kind: intent === "edit" ? "edit" : "generate",
        intent,
        prompt,
        instruction: (input.instruction ?? "").trim(),
        referenceJson: JSON.stringify({ assetIds: project.assets.map(item => item.id), variantIds: project.rounds.flatMap(r => r.variants.filter(v => v.selected).map(v => v.id)), context: context.manifest }),
        mode: input.provider ? "mock" : "live",
        provider: generated.provider,
        model: generated.model,
        status: "succeeded",
        variants: { create: variantRows },
      },
    });
    await tx.sourceDocument.update({
      where: { id: source.id },
      data: { parseStatus: "succeeded" },
    });
    await tx.aiJob.update({
      where: { id: job.id },
      data: { status: "succeeded", outputJson: JSON.stringify({ roundId, count: generated.images.length }) },
    });
    await writeAudit({
      organizationId: input.organizationId,
      actorUserId: input.userId,
      action: "design.round.generated",
      entityType: "DesignProject",
      entityId: project.id,
      summary: `${project.code} 第 ${versionNumber} 轮生成 ${variantRows.length} 张`,
      payloadJson: JSON.stringify({ before: { latestRound: project.rounds[0]?.id ?? null }, after: { roundId, variantIds: variantRows.map(v => v.id), provider: generated.provider, model: generated.model }, context: context.manifest }),
    }, tx);
    });
    return getDesignProject(input.organizationId, project.id);
  } catch (error) {
    const failure = asError(error, "生成失败");
    await prisma.aiJob.update({
      where: { id: job.id },
      data: { status: "failed", errorMessage: failure.message },
    });
    await prisma.sourceDocument.update({
      where: { id: source.id },
      data: { parseStatus: "failed" },
    });
    throw failure;
  }
  } finally { activeGenerations.delete(lockKey); }
}

export async function editDesignRound(input: Actor & {
  projectId: string;
  instruction: string;
  prompt?: string;
  provider?: DesignImageProvider;
}) {
  const instruction = input.instruction.trim();
  if (!instruction) throw new DesignStudioError("请写下要改的地方");
  return generateDesignRound({
    ...input,
    prompt: (input.prompt ?? instruction).trim(),
    instruction,
    intent: "edit",
    count: 1,
  });
}

export async function selectDesignVariants(input: Actor & { projectId: string; variantIds: string[] }) {
  await assertDraft(input, ACTION_TYPES.generateDesignImage);
  const project = await loadProject(input.organizationId, input.projectId);
  const allowed = new Set(project.rounds.flatMap((round) => round.variants.map((item) => item.id)));
  if (input.variantIds.some((id) => !allowed.has(id))) {
    throw new DesignStudioError("只能勾选本草案里的方案");
  }
  const selected = new Set(input.variantIds);
  await prisma.$transaction(async tx => {
    await tx.$executeRaw`UPDATE DesignProject SET name=name WHERE id=${project.id}`;
    const current = await tx.designProject.findUniqueOrThrow({ where: { id: project.id }, include: { rounds: { include: { variants: true } } } });
    if (current.status !== "open") throw new DesignStudioError("已采用草案不能改变采用的方案");
    const before = current.rounds.flatMap(r => r.variants.filter(v => v.selected).map(v => v.id));
    for (const r of current.rounds) for (const v of r.variants) await tx.designVariant.update({ where: { id: v.id }, data: { selected: selected.has(v.id) } });
    await writeAudit({ organizationId: input.organizationId, actorUserId: input.userId, action: "design.variants.selected", entityType: "DesignProject", entityId: project.id, summary: "人工修改设计方案选择", payloadJson: JSON.stringify({ before, after: [...selected] }) }, tx);
  });
  return getDesignProject(input.organizationId, project.id);
}

export async function adoptDesignDraft(input: Actor & {
  projectId: string;
  target: "development" | "style";
}) {
  await assertDraft(input, ACTION_TYPES.adoptDesignDraft);
  const project = await prisma.designProject.findFirst({
    where: { id: input.projectId, organizationId: input.organizationId },
    include: {
      style: { include: { versions: true } },
      material: true,
      rounds: { include: { variants: true }, orderBy: { versionNumber: "desc" } },
    },
  });
  if (!project) throw new DesignStudioError("设计草案不存在或不属于当前组织");
  if (project.status === "adopted") {
    return {
      reused: true,
      projectId: project.id,
      styleId: project.styleId,
      developmentProjectId: project.developmentProjectId,
      message: "这份草案已经转入过开发",
    };
  }
  const selected = project.rounds.flatMap((round) => round.variants.filter((item) => item.selected));
  if (selected.length === 0) throw new DesignStudioError("先勾选要留下的方案，再转入开发");

  const currentContext = await resolveContext({ ...input, factoryId: null }, "design");
  for (const round of project.rounds.filter(r => r.variants.some(v => v.selected))) {
    const used = JSON.parse(round.referenceJson).context;
    if (!used || used.platformVersion !== currentContext.manifest.platformVersion || used.platformHash !== currentContext.manifest.platformHash || JSON.stringify(used.references) !== JSON.stringify(currentContext.manifest.references)) throw new DesignStudioError("设计依据版本已变化或未留版本，请重新核对并生成后采用");
  }
  const result = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`UPDATE DesignProject SET name=name WHERE id=${project.id}`;
    const fresh = await tx.designProject.findUniqueOrThrow({ where: { id: project.id }, include: { rounds: { include: { variants: true } } } });
    if (fresh.status !== "open") throw new DesignStudioError("草案已被采用，请刷新查看结果");
    const selectedNow = fresh.rounds.flatMap(r => r.variants.filter(v => v.selected).map(v => v.id)).sort();
    if (JSON.stringify(selectedNow) !== JSON.stringify(selected.map(v => v.id).sort())) throw new DesignStudioError("选定方案已变化，请刷新核对后再采用");
    let styleId = project.styleId;
    let versionId: string | null = null;
    let developmentProjectId = project.developmentProjectId;

    if (input.target === "style") {
      if (!styleId) {
        const exists = await tx.style.findFirst({
          where: { organizationId: input.organizationId, code: project.code },
        });
        styleId = exists?.id ?? createId();
        if (!exists) {
          await tx.style.create({
            data: {
              id: styleId,
              organizationId: input.organizationId,
              code: project.code,
              name: project.name,
              category: "未填写",
              silhouette: "未填写",
              status: "development",
              imagePath: selected[0].imagePath,
              demoNote: "设计工作台采用，非正式大货号，资料未齐，不能投产",
              createdByUserId: input.userId,
            },
          });
        }
      }
      const approved = await tx.styleVersion.findMany({
        where: { styleId, status: "approved" },
      });
      const maxVersion = await tx.styleVersion.aggregate({
        where: { styleId },
        _max: { versionNumber: true },
      });
      versionId = createId();
      await tx.styleVersion.create({
        data: {
          id: versionId,
          styleId,
          versionNumber: (maxVersion._max.versionNumber ?? 0) + 1,
          status: "draft",
          cuffType: "未填写",
          changeSummary: `设计草案 ${project.code} 采用，非正式批准`,
          specNotes: project.brief,
          processNotes: "",
          patternRevision: "",
        },
      });
      for (const variant of selected) {
        await tx.styleVersionAttachment.create({
          data: {
            id: createId(),
            styleVersionId: versionId,
            kind: "design",
            fileName: `${variant.label}.png`,
            storagePath: variant.imagePath,
            mimeType: variant.mimeType,
          },
        });
      }
      if (approved.some((item) => item.id === versionId)) {
        throw new DesignStudioError("禁止覆盖已批准资料");
      }
    } else if (!developmentProjectId) {
      developmentProjectId = createId();
      await tx.developmentProject.create({
        data: {
          id: developmentProjectId,
          organizationId: input.organizationId,
          code: `DEV-${project.code}`,
          name: project.name,
          styleId,
          status: "open",
          unknownsJson: JSON.stringify(["设计图非正式资料", "色尺未确认", "工艺未确认"]),
        },
      });
      if (project.materialId) {
        await tx.developmentCandidate.create({
          data: {
            id: createId(),
            projectId: developmentProjectId,
            kind: "material",
            materialId: project.materialId,
            copyMode: "reference",
            unconfirmedJson: JSON.stringify(["手感待测", "历史批准不可沿用"]),
            note: "引用已有材料，不是采购",
          },
        });
      }
    }

    await tx.taskItem.create({
      data: {
        id: createId(),
        organizationId: input.organizationId,
        title: "核对设计草案资料",
        kind: "design_draft_review",
        status: "open",
        blocking: true,
        relatedStyleId: styleId,
        note: `${project.code} 已转入开发，未批准，不能投产`,
      },
    });
    await tx.designProject.update({
      where: { id: project.id },
      data: {
        status: "adopted",
        styleId,
        developmentProjectId,
      },
    });
    await writeAudit({ organizationId: input.organizationId, actorUserId: input.userId, action: "design.draft.adopted", entityType: "DesignProject", entityId: project.id, summary: `草案 ${project.code} 转入${input.target === "style" ? "资料草稿" : "开发款式"}，未批准`, payloadJson: JSON.stringify({ actionType: ACTION_TYPES.adoptDesignDraft, target: input.target, styleId, versionId, developmentProjectId, before: { status: project.status }, after: { status: "adopted", styleId, versionId, developmentProjectId }, selectedVariantIds: selectedNow }) }, tx);
    return { styleId, versionId, developmentProjectId, approvedKept: true };
  });

  return {
    reused: false,
    projectId: project.id,
    styleId: result.styleId,
    versionId: result.versionId,
    developmentProjectId: result.developmentProjectId,
    message:
      input.target === "style"
        ? "已转入款式资料草稿。不是批准，不能投产，没有采购。"
        : "已转入开发款式。非正式款号，不能投产，没有采购。",
  };
}

export async function readDesignAssetImage(input: { organizationId: string; assetId: string }) {
  const asset = await prisma.designAsset.findFirst({
    where: { id: input.assetId, project: { organizationId: input.organizationId } },
  });
  if (!asset) throw new DesignStudioError("参考图不存在");
  return { bytes: await readPrivateFile(asset.imagePath), mime: asset.mimeType };
}

export async function readDesignVariantImage(input: { organizationId: string; variantId: string }) {
  const variant = await prisma.designVariant.findFirst({
    where: { id: input.variantId, round: { project: { organizationId: input.organizationId } } },
  });
  if (!variant) throw new DesignStudioError("方案图不存在");
  return { bytes: await readPrivateFile(variant.imagePath), mime: variant.mimeType };
}
