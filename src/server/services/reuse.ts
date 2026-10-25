import { prisma } from "@/lib/db";
import { createId } from "@/lib/hash";
import { writeAudit } from "@/server/services/intake";
import { styleImageSrc } from "@/lib/style-image";
import { ACTION_TYPES } from "@/lib/constants";
import { canApproveAction } from "@/server/permissions";
import { lockOrganizationForWrite } from "@/server/services/order-write";
import type { Prisma } from "@prisma/client";

const MUST_RECONFIRM = ["历史客户批准不可沿用", "历史报价不是本项目成本", "手感与缩水待测"];

export class ReuseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReuseError";
  }
}

function tokenize(query: string) {
  const tokens: string[] = [];
  for (const token of ["圆领", "针织", "轻薄", "纱", "棉"]) {
    if (query.includes(token)) tokens.push(token);
  }
  const codes = query.match(/ST-[\d]+|YARN-DEMO-\d+|MAT-\d+/g) ?? [];
  return { tokens, codes, preferAvailable: /可用材料|已有可用/.test(query) };
}

export async function searchKnowledge(input: { organizationId: string; query: string }, db: Prisma.TransactionClient = prisma) {
  const parsed = tokenize(input.query);
  const styles = await db.style.findMany({
    where: { organizationId: input.organizationId },
    include: {
      versions: { include: { bomLines: { include: { material: true } } } },
    },
  });
  const materials = await db.material.findMany({
    where: { organizationId: input.organizationId },
    include: { lots: true, quotes: true, bomLines: { include: { version: { include: { style: true } } } } },
  });

  const styleHits = styles
    .map((style) => {
      const haystack = `${style.code} ${style.name} ${style.category} ${style.silhouette}`;
      const matchReasons = [
        ...parsed.tokens.filter((token) => haystack.includes(token)).map((token) => `字段含「${token}」`),
        ...parsed.codes.filter((code) => haystack.includes(code)).map((code) => `款号/编码 ${code}`),
      ];
      if (!matchReasons.length) return null;
      const diffs = ["本候选是历史款，不是本次已确认的新开发结果"];
      if (style.code === "ST-26018") diffs.push("已有圆领针织档案，袖口/纱线规格仍需按本季重确认");
      return {
        id: style.id,
        kind: "style" as const,
        code: style.code,
        name: style.name,
        imagePath: styleImageSrc(style),
        matchReasons,
        differences: diffs,
        historicalApprovalReusable: false,
        bomMaterials: style.versions.flatMap((version) => version.bomLines.map((line) => line.material.code)),
      };
    })
    .filter((row): row is NonNullable<typeof row> => Boolean(row));

  const materialHits = materials
    .map((material) => {
      const haystack = `${material.code} ${material.name} ${material.kind} ${material.specSummary}`;
      const tokenHit = parsed.tokens.some((token) => haystack.includes(token) || material.kind === "yarn");
      const codeHit = parsed.codes.some((code) => haystack.includes(code));
      const preferYarn = parsed.preferAvailable || /纱|针织/.test(input.query);
      if (!codeHit && !tokenHit && !(preferYarn && (material.kind === "yarn" || material.kind === "fabric"))) {
        return null;
      }
      const onHand = material.lots.reduce((sum, lot) => sum + Number(lot.qtyOnHand), 0);
      const allocated = material.lots.reduce((sum, lot) => sum + Number(lot.qtyAllocated), 0);
      const freeQty = Math.max(0, onHand - allocated);
      const matchReasons = [
        ...(codeHit ? [`编码与查询一致`] : []),
        ...(material.kind === "yarn" ? ["种类为纱线，与针织开发相关"] : []),
        ...(freeQty > 0 ? [`存在可分配库存 ${freeQty} ${material.unit}`] : ["当前无可分配库存或尚未到料"]),
      ];
      return {
        id: material.id,
        kind: "material" as const,
        code: material.code,
        name: material.name,
        specSummary: material.specSummary,
        freeQty: String(freeQty),
        unit: material.unit,
        historicalPriceMinor: material.quotes[0]?.unitPriceMinor ?? null,
        historicalApprovalReusable: false,
        matchReasons,
        differences: ["历史报价和旧客户批准不是本项目直接可用条件", "手感/缩水未测不得视为合格"],
      };
    })
    .filter((row): row is NonNullable<typeof row> => Boolean(row));

  const rankedMaterials = parsed.preferAvailable
    ? [...materialHits].sort((a, b) => Number(b.freeQty) - Number(a.freeQty))
    : materialHits;

  return {
    query: input.query,
    matchMethod: "keyword" as const,
    matchLabel: "资料匹配",
    visionEnabled: false,
    styles: styleHits,
    materials: rankedMaterials,
  };
}

async function assertReuseActor(db: Prisma.TransactionClient, input: { organizationId: string; userId: string }) {
  const actor = await db.user.findFirst({ where: { id: input.userId, organizationId: input.organizationId, active: true } });
  if (!actor || !canApproveAction(actor.role, ACTION_TYPES.createDevelopmentProject)) throw new ReuseError("当前账号无权修改开发资料引用");
}

export async function adoptReuseCandidate(input: {
  organizationId: string;
  userId: string;
  projectId: string;
  candidateKind: "style" | "material";
  candidateId: string;
  query: string;
}) {
  return prisma.$transaction(async tx => {
    await lockOrganizationForWrite(tx, input.organizationId);
    await assertReuseActor(tx, input);
    const project = await tx.developmentProject.findFirst({
      where: { id: input.projectId, organizationId: input.organizationId },
  });
  if (!project) throw new ReuseError("开发款式不存在或不属于当前组织");

  const search = await searchKnowledge({ organizationId: input.organizationId, query: input.query }, tx);
  const candidate =
    input.candidateKind === "style"
      ? search.styles.find((row) => row.id === input.candidateId)
      : search.materials.find((row) => row.id === input.candidateId);
  if (!candidate) throw new ReuseError("候选不属于当前组织检索结果");

  const existing = await tx.developmentCandidate.findFirst({
    where: {
      projectId: project.id,
      kind: input.candidateKind,
      ...(input.candidateKind === "style" ? { styleId: input.candidateId } : { materialId: input.candidateId }),
    },
  });
  if (existing) return { candidateId: existing.id, copyMode: "reference" as const, mustReconfirm: JSON.parse(existing.unconfirmedJson) as string[], projectId: project.id };
  const record =
    (await tx.developmentCandidate.create({
      data: {
        id: createId(),
        projectId: project.id,
        kind: input.candidateKind,
        styleId: input.candidateKind === "style" ? input.candidateId : null,
        materialId: input.candidateKind === "material" ? input.candidateId : null,
        copyMode: "reference",
        unconfirmedJson: JSON.stringify(MUST_RECONFIRM),
        note: "采用历史资料作为引用，不是复制主档，也不是本季批准",
      },
    }));

  await tx.knowledgeReuseEvent.create({
    data: {
      id: createId(),
      organizationId: input.organizationId,
      query: input.query,
      candidateKind: input.candidateKind,
      candidateId: input.candidateId,
      matchMethod: "keyword",
      matchReasonsJson: JSON.stringify("matchReasons" in candidate ? candidate.matchReasons : []),
      differencesJson: JSON.stringify(MUST_RECONFIRM),
      status: "adopted",
      adoptedProjectId: project.id,
      actorUserId: input.userId,
    },
  });
  await writeAudit({
    organizationId: input.organizationId,
    actorUserId: input.userId,
    action: "reuse.adopted",
    entityType: "DevelopmentProject",
    entityId: project.id,
    summary: `已引用${input.candidateKind === "style" ? "历史款" : "材料"}，未迁移历史批准`,
    payloadJson: JSON.stringify({ before: null, after: { candidateId: record.id, kind: input.candidateKind, sourceId: input.candidateId, copyMode: "reference", mustReconfirm: MUST_RECONFIRM }, basis: { projectId: project.id, query: input.query, matchMethod: "keyword", matchReasons: candidate.matchReasons } }),
  }, tx);

  return {
    candidateId: record.id,
    copyMode: "reference" as const,
    mustReconfirm: MUST_RECONFIRM,
    projectId: project.id,
  };
  });
}

export async function rejectReuseCandidate(input: {
  organizationId: string;
  userId: string;
  candidateKind: "style" | "material";
  candidateId: string;
  query: string;
  reason: string;
}) {
  return prisma.$transaction(async tx => {
    await lockOrganizationForWrite(tx, input.organizationId);
    await assertReuseActor(tx, input);
    const candidate = input.candidateKind === "style"
      ? await tx.style.findFirst({ where: { id: input.candidateId, organizationId: input.organizationId } })
      : await tx.material.findFirst({ where: { id: input.candidateId, organizationId: input.organizationId } });
    if (!candidate) throw new ReuseError("候选不存在或不属于当前组织");
    const event = await tx.knowledgeReuseEvent.create({
      data: {
        id: createId(),
        organizationId: input.organizationId,
        query: input.query,
        candidateKind: input.candidateKind,
        candidateId: input.candidateId,
        matchMethod: "keyword",
        matchReasonsJson: "[]",
        differencesJson: "[]",
        status: "rejected",
        rejectReason: input.reason,
        actorUserId: input.userId,
      },
  });
  await writeAudit({
    organizationId: input.organizationId,
    actorUserId: input.userId,
    action: "reuse.rejected",
    entityType: "KnowledgeReuseEvent",
    entityId: event.id,
    summary: `拒绝复用候选：${input.reason}`,
    payloadJson: JSON.stringify({ before: null, after: { status: "rejected", reason: input.reason }, basis: { candidateKind: input.candidateKind, candidateId: candidate.id, query: input.query } }),
  }, tx);
  return { status: event.status, rejectReason: event.rejectReason };
  });
}

export async function linkProjectToStyle(input: {
  organizationId: string;
  userId: string;
  projectId: string;
  styleId: string;
}) {
  return prisma.$transaction(async tx => {
    await lockOrganizationForWrite(tx, input.organizationId);
    const actor = await tx.user.findFirst({ where: { id: input.userId, organizationId: input.organizationId, active: true } });
    if (!actor || !canApproveAction(actor.role, ACTION_TYPES.createDevelopmentProject)) throw new ReuseError("当前账号无权关联开发款式");
    const project = await tx.developmentProject.findFirst({
      where: { id: input.projectId, organizationId: input.organizationId },
      include: { candidates: true },
  });
  if (!project) throw new ReuseError("开发款式不存在或不属于当前组织");
  const style = await tx.style.findFirst({
    where: { id: input.styleId, organizationId: input.organizationId },
  });
  if (!style) throw new ReuseError("款式不存在或不属于当前组织");

  const materialRefs = project.candidates.filter(row => row.kind === "material").length;
  if (project.styleId === style.id) return { styleId: style.id, materialRefs, reused: true };
  if (project.styleId) throw new ReuseError("开发款式已经关联其他主款，不能直接覆盖原关联，请先核对原记录");
  const unknowns = (JSON.parse(project.unknownsJson) as string[]).filter(value => value !== "尚未关联款号");
  await tx.developmentProject.update({
    where: { id: project.id },
    data: { styleId: style.id, status: "linked", unknownsJson: JSON.stringify(unknowns) },
  });
  await writeAudit({
    organizationId: input.organizationId,
    actorUserId: input.userId,
    action: "development.linked_style",
    entityType: "DevelopmentProject",
    entityId: project.id,
    summary: `开发款式关联款式 ${style.code}，未复制材料主档`,
    payloadJson: JSON.stringify({ before: { styleId: project.styleId, status: project.status, unknowns: JSON.parse(project.unknownsJson) }, after: { styleId: style.id, status: "linked", unknowns }, basis: { projectId: project.id, styleCode: style.code, materialRefs }, result: { styleId: style.id, materialRefs } }),
  }, tx);
  return { styleId: style.id, materialRefs, reused: false };
  });
}
