import { ACTION_TYPES, IDS } from "@/lib/constants";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { createId, normalizeSourceText, sha256 } from "@/lib/hash";
import { demoNow } from "@/lib/clock";
import { getAiMode } from "@/lib/ai-config";
import { extractFromText } from "@/server/ai/provider";
import type { Extraction } from "@/server/ai/schema";
import { styleImageSrc } from "@/lib/style-image";
import { blockingTaskHref } from "@/lib/task-href";

export async function ingestText(input: {
  organizationId: string;
  userId: string;
  text: string;
  origin: string;
  filename?: string;
}) {
  const rawText = normalizeSourceText(input.text);
  const contentHash = sha256(`${input.organizationId}:${rawText}`);
  const existing = await prisma.sourceDocument.findUnique({
    where: {
      organizationId_contentHash: {
        organizationId: input.organizationId,
        contentHash,
      },
    },
  });
  if (existing) {
    await writeAudit({
      organizationId: input.organizationId,
      actorUserId: input.userId,
      action: "source.duplicate_detected",
      entityType: "SourceDocument",
      entityId: existing.id,
      summary: "重复提交同一内容，未新建来源，也未创建订单",
    });
    return { source: existing, alreadyExisted: true };
  }

  const source = await prisma.sourceDocument.create({
    data: {
      id: createId(),
      organizationId: input.organizationId,
      contentHash,
      origin: input.origin,
      filename: input.filename ?? null,
      mimeType: "text/plain",
      rawText,
      receivedAt: demoNow(),
      parseStatus: "queued",
    },
  });
  await writeAudit({
    organizationId: input.organizationId,
    actorUserId: input.userId,
    action: "source.ingested",
    entityType: "SourceDocument",
    entityId: source.id,
    summary: "已保存原始资料及内容哈希",
  });
  return { source, alreadyExisted: false };
}

function shouldSkipSemanticParse(source: { rawText: string }) {
  return source.rawText.includes("未进行语义识别");
}

export async function parseSource(input: {
  organizationId: string;
  userId: string;
  sourceId: string;
}) {
  const source = await prisma.sourceDocument.findFirst({
    where: { id: input.sourceId, organizationId: input.organizationId },
  });
  if (!source) {
    throw new Error("来源不存在或不属于当前组织");
  }

  // Re-parsing changes the approval basis, even when parsing later fails or times out.
  await prisma.actionProposal.updateMany({
    where: { sourceDocumentId: source.id, organizationId: input.organizationId, status: "preview" },
    data: { status: "expired" },
  });

  const job = await prisma.aiJob.create({
    data: {
      id: createId(),
      organizationId: input.organizationId,
      sourceDocumentId: source.id,
      mode: process.env.AI_MODE === "live" ? "live" : "mock",
      provider: process.env.AI_PROVIDER || "mock-rules",
      status: "running",
      attempt: 1,
    },
  });

  if (shouldSkipSemanticParse(source)) {
    const mode = getAiMode();
    const output = {
      visionConfigured: false,
      recognized: false,
      extractedBom: false,
      calledLiveModel: false,
      mode,
      message: source.rawText,
    };
    await prisma.aiJob.update({
      where: { id: job.id },
      data: {
        status: "skipped_no_vision",
        outputJson: JSON.stringify(output),
        errorMessage: null,
      },
    });
    await prisma.sourceDocument.update({
      where: { id: source.id },
      data: { parseStatus: "saved_without_vision" },
    });
    return {
      jobId: job.id,
      extraction: null,
      candidates: [],
      diffs: [],
      proposal: null,
      mode,
      calledLiveModel: false,
      visionSkipped: true,
    };
  }

  try {
    const { extraction, mode, calledLiveModel } = await extractFromText(source.rawText);
    const candidates = await findStyleCandidates(input.organizationId, extraction, source.rawText);
    const selected = candidates.length === 1 ? candidates[0] : null;
    const diffs = selected ? await buildDiffs(selected.styleId, extraction) : [];
    const historical = selected
      ? await prisma.salesOrder.findFirst({
          where: {
            organizationId: input.organizationId,
            status: { in: ["confirmed", "completed", "in_production"] },
            lines: { some: { styleId: selected.styleId } },
          },
          orderBy: { createdAt: "asc" },
        })
      : null;

    await prisma.sourceFragment.deleteMany({ where: { sourceDocumentId: source.id } });
    await saveFragments(source.id, extraction);
    await saveLocatorFragments(source.id, source.rawText);

    const proposal =
      extraction.intent === "material_dev"
        ? await upsertDevelopmentProposal({
            organizationId: input.organizationId,
            jobId: job.id,
            sourceId: source.id,
            extraction,
          })
        : selected
          ? await upsertProposal({
              organizationId: input.organizationId,
              jobId: job.id,
              sourceId: source.id,
              extraction,
              selectedStyleId: selected.styleId,
              historicalOrderId: historical?.id ?? null,
              historicalPo: historical?.externalCustomerPo ?? null,
              diffs,
            })
          : null;

    await prisma.aiJob.update({
      where: { id: job.id },
      data: {
        status: extraction.intent === "unknown" ? "failed" : "needs_review",
        outputJson: JSON.stringify({ extraction, candidates, diffs, calledLiveModel, mode }),
        errorMessage:
          extraction.intent === "unknown" ? extraction.unknowns.join("；") : null,
      },
    });
    await prisma.sourceDocument.update({
      where: { id: source.id },
      data: { parseStatus: extraction.intent === "unknown" ? "failed" : "needs_review" },
    });

    return {
      jobId: job.id,
      extraction,
      candidates,
      diffs,
      proposal,
      mode,
      calledLiveModel,
      tasks: buildHandleTasks({ extraction, candidates, proposal }),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "解析失败";
    await prisma.aiJob.update({
      where: { id: job.id },
      data: { status: "failed", errorMessage: message },
    });
    await prisma.sourceDocument.update({
      where: { id: source.id },
      data: { parseStatus: "failed" },
    });
    throw error;
  }
}

export type StyleCandidate = {
  styleId: string;
  code: string;
  name: string;
  imagePath: string;
  reason: string;
  orderNo: string | null;
  selected: boolean;
};

export type HandleTask = {
  id: "choose_history" | "color_unconfirmed" | "size_incomplete";
  status: "open" | "done";
  title: string;
  href: string | null;
};

export function buildHandleTasks(input: {
  extraction: Extraction | null;
  candidates: StyleCandidate[];
  proposal: { id?: string } | null;
  orderId?: string | null;
  orderTasks?: Array<{ kind: string; status: string }>;
}) {
  const tasks: HandleTask[] = [];
  const selected = input.candidates.find((item) => item.selected);
  if (input.candidates.length > 1 && !selected && !input.proposal) {
    tasks.push({
      id: "choose_history",
      status: "open",
      title: `已找到 ${input.candidates.length} 份可能相关的历史资料，需要你选择。`,
      href: null,
    });
  } else if (selected || input.candidates.length === 1) {
    const style = selected ?? input.candidates[0];
    tasks.push({
      id: "choose_history",
      status: "done",
      title: input.proposal
        ? `已选定 ${style.code}，只建引用，必须重确认。`
        : `已按款号对应 ${style.code}，只建引用，必须重确认。`,
      href: null,
    });
  }
  const colorUnconfirmed =
    Boolean(input.extraction?.unknowns.includes("新颜色未确认")) ||
    Boolean(input.extraction?.modifications.some((item) => item.field === "colorway"));
  if (colorUnconfirmed) {
    const approval = input.orderTasks?.find((task) => task.kind === "missing_approval");
    tasks.push({
      id: "color_unconfirmed",
      status: approval?.status === "done" ? "done" : "open",
      title: "新颜色尚未确认，不能沿用旧样品批准。",
      href: input.orderId ? blockingTaskHref("missing_approval", input.orderId) : null,
    });
  }
  if (input.extraction?.unknowns.includes("尺码明细")) {
    const sizeTask = input.orderTasks?.find((task) => task.kind === "missing_size_breakdown");
    tasks.push({
      id: "size_incomplete",
      status: sizeTask?.status === "done" ? "done" : "open",
      title: "尺码未齐，暂不形成完整数量明细。",
      href: input.orderId ? blockingTaskHref("missing_size_breakdown", input.orderId) : null,
    });
  }
  return tasks;
}

async function findStyleCandidates(organizationId: string, extraction: Extraction, rawText: string): Promise<StyleCandidate[]> {
  const code = extraction.styleCode.value;
  if (code && typeof code === "string") {
    const styles = await prisma.style.findMany({
      where: { organizationId, code },
      include: { versions: { orderBy: { versionNumber: "asc" } } },
    });
    return styles.map((style) => ({
      styleId: style.id,
      code: style.code,
      name: style.name,
      imagePath: styleImageSrc(style),
      reason: `款号 ${style.code} 与原文一致，属于当前组织，不因此新建主款`,
      orderNo: null,
      selected: styles.length === 1,
    }));
  }
  const reuse = Boolean(extraction.reuseExistingStyle.value) || /还是上次那款|增加一批/.test(rawText);
  if (!reuse) return [];
  const customerName = typeof extraction.customerName.value === "string" ? extraction.customerName.value : null;
  const customer = await prisma.customer.findFirst({
    where: customerName
      ? { organizationId, name: customerName }
      : { organizationId, name: "北岸服饰" },
  });
  const orders = await prisma.salesOrder.findMany({
    where: {
      organizationId,
      status: { in: ["confirmed", "completed", "in_production"] },
      ...(customer ? { customerId: customer.id } : {}),
    },
    include: { lines: { include: { style: true } } },
    orderBy: { createdAt: "desc" },
  });
  const seen = new Set<string>();
  const candidates: StyleCandidate[] = [];
  for (const order of orders) {
    for (const line of order.lines) {
      if (seen.has(line.styleId)) continue;
      seen.add(line.styleId);
      candidates.push({
        styleId: line.styleId,
        code: line.style.code,
        name: line.style.name,
        imagePath: styleImageSrc(line.style),
        reason: `资料匹配：历史订单 ${order.orderNo}，不是视觉识款`,
        orderNo: order.orderNo,
        selected: false,
      });
      if (candidates.length >= 4) return candidates;
    }
  }
  return candidates;
}

async function buildDiffs(styleId: string, extraction: Extraction) {
  const approved = await prisma.styleVersion.findFirst({
    where: { styleId, status: "approved" },
    orderBy: { versionNumber: "desc" },
  });
  const diffs = [];
  const cuffChange = extraction.modifications.find((item) => item.field === "cuffType");
  if (cuffChange) {
    diffs.push({
      field: "袖口",
      previous: approved?.cuffType ?? "未知",
      incoming: cuffChange.requested,
      impact: "可能影响袖口材料、工艺与确认，不能覆盖已批准 V1",
    });
  }
  const colorChange = extraction.modifications.find((item) => item.field === "colorway");
  if (colorChange) {
    diffs.push({
      field: "颜色",
      previous: "历史样品颜色",
      incoming: colorChange.requested,
      impact: "新颜色尚未确认，不能沿用旧样品批准",
    });
  }
  diffs.push({
    field: "客户PO",
    previous: "历史订单可能有 PO",
    incoming: extraction.externalCustomerPo.value ?? "空",
    impact: "新订单外部 PO 保持为空，不沿用上一单",
  });
  diffs.push({
    field: "尺码明细",
    previous: "历史订单可有完整色尺",
    incoming: "未提供",
    impact: "本单不能生成正式 SKU 行，也不能批准投产",
  });
  return diffs;
}

async function saveFragments(sourceId: string, extraction: Extraction) {
  const rows = [
    extraction.customerName,
    extraction.styleCode,
    extraction.totalQuantity,
    extraction.deliveryText,
    extraction.externalCustomerPo,
    ...extraction.colors.map((color) => ({
      start: color.start,
      end: color.end,
      sourceText: color.sourceText,
    })),
    ...extraction.modifications,
    ...(extraction.materials ?? []),
  ];
  const data = rows
    .filter((row) => row.start != null && row.end != null && row.sourceText)
    .map((row) => ({
      id: createId(),
      sourceDocumentId: sourceId,
      startOffset: row.start as number,
      endOffset: row.end as number,
      text: row.sourceText as string,
    }));
  if (data.length) {
    await prisma.sourceFragment.createMany({ data });
  }
}

function locatorFragmentsFromText(text: string) {
  const rows: Array<{ startOffset: number; endOffset: number; text: string }> = [];
  const pattern = /^(?:[^\n!]+![A-Z]+\d+|第\d+页 \S+)\t[^\n]+/gm;
  for (const match of text.matchAll(pattern)) {
    const start = match.index ?? 0;
    rows.push({ startOffset: start, endOffset: start + match[0].length, text: match[0] });
  }
  return rows;
}

async function saveLocatorFragments(sourceId: string, rawText: string) {
  const data = locatorFragmentsFromText(rawText).map((row) => ({
    id: createId(),
    sourceDocumentId: sourceId,
    ...row,
  }));
  if (data.length) {
    await prisma.sourceFragment.createMany({ data });
  }
}

function willCreateForDraft(extraction: Extraction) {
  const rows = ["订单草稿", "资料版本草稿"];
  if (extraction.unknowns.includes("尺码明细")) rows.push("尺码任务");
  if (extraction.unknowns.includes("罗纹规格与批准")) rows.push("罗纹规格任务");
  if (extraction.unknowns.includes("交期年份推断") || extraction.deliveryDateInferred.inferenceNote) {
    rows.push("交期年份任务");
  }
  if (extraction.unknowns.includes("新颜色未确认") || extraction.modifications.some((item) => item.field === "colorway")) {
    rows.push("颜色确认任务");
  }
  return rows;
}

async function expectedForOrderDraft(styleId: string, historicalOrderId: string | null, historicalPo: string | null) {
  const approved = await prisma.styleVersion.findFirst({
    where: { styleId, status: "approved" },
    orderBy: { versionNumber: "desc" },
  });
  return {
    approvedVersionStatus: "approved",
    approvedVersionId: approved?.id ?? null,
    approvedVersionNumber: approved?.versionNumber ?? null,
    historicalOrderId,
    historicalPo,
    styleId,
  };
}

async function upsertProposal(input: {
  organizationId: string;
  jobId: string;
  sourceId: string;
  extraction: Extraction;
  selectedStyleId: string;
  historicalOrderId: string | null;
  historicalPo: string | null;
  diffs: unknown;
}) {
  const idempotencyKey = `reorder:${input.organizationId}:${input.selectedStyleId}:${await hashOfSource(input.sourceId)}:create_order_draft`;
  const payload = {
    actionType: ACTION_TYPES.createOrderDraft,
    selectedStyleId: input.selectedStyleId,
    customerCodeHint: input.extraction.customerName.value,
    colors: input.extraction.colors,
    totalQuantity: input.extraction.totalQuantity.value,
    externalCustomerPo: null,
    deliveryText: input.extraction.deliveryText.value,
    deliveryDateInferred: input.extraction.deliveryDateInferred.value,
    deliveryYearInference: input.extraction.deliveryDateInferred.inferenceNote,
    modifications: input.extraction.modifications,
    unknowns: input.extraction.unknowns,
    jailbreakAttempt: input.extraction.jailbreakAttempt,
    willCreate: willCreateForDraft(input.extraction),
    willNotChange: ["款式主档", "历史订单", "已批准 BOM V1", "历史客户PO"],
    productionReadiness: "blocked_incomplete_spec",
  };
  const existing = await prisma.actionProposal.findUnique({
    where: { organizationId_idempotencyKey: { organizationId: input.organizationId, idempotencyKey } },
  });
  if (existing?.status === "executed") return existing;
  if (existing) {
    return prisma.actionProposal.update({
      where: { id: existing.id },
      data: {
        aiJobId: input.jobId,
        status: "preview",
        payloadJson: JSON.stringify(payload),
        evidenceJson: JSON.stringify(input.extraction),
        risksJson: JSON.stringify(input.diffs),
        expectedJson: JSON.stringify(await expectedForOrderDraft(input.selectedStyleId, input.historicalOrderId, input.historicalPo)),
      },
    });
  }
  return prisma.actionProposal.create({
    data: {
      id: createId(),
      organizationId: input.organizationId,
      aiJobId: input.jobId,
      sourceDocumentId: input.sourceId,
      actionType: ACTION_TYPES.createOrderDraft,
      idempotencyKey,
      status: "preview",
      payloadJson: JSON.stringify(payload),
      evidenceJson: JSON.stringify(input.extraction),
      risksJson: JSON.stringify(input.diffs),
      expectedJson: JSON.stringify(await expectedForOrderDraft(input.selectedStyleId, input.historicalOrderId, input.historicalPo)),
      approvalRequired: true,
    },
  });
}

async function upsertDevelopmentProposal(input: {
  organizationId: string;
  jobId: string;
  sourceId: string;
  extraction: Extraction;
}) {
  const idempotencyKey = `material_dev:${input.organizationId}:${await hashOfSource(input.sourceId)}:create_development_project`;
  const payload = {
    actionType: ACTION_TYPES.createDevelopmentProject,
    customerName: input.extraction.customerName.value,
    materials: input.extraction.materials,
    unknowns: input.extraction.unknowns,
    willCreate: ["材料开发款式", "候选纱线引用", "试验待办"],
    willNotChange: ["款式主档", "材料主档", "历史客户批准", "历史报价可用性"],
    copyMode: "reference",
  };
  const diffs = [
    {
      field: "款号",
      previous: "无",
      incoming: "尚未确定",
      impact: "允许先保存开发款式，不强制从款号开始",
    },
    {
      field: "试验与批准",
      previous: "历史款可能有旧通过意见",
      incoming: "无试验报告",
      impact: "旧客户批准不能当作本次批准",
    },
  ];
  const existing = await prisma.actionProposal.findUnique({
    where: { organizationId_idempotencyKey: { organizationId: input.organizationId, idempotencyKey } },
  });
  const data = {
    aiJobId: input.jobId,
    status: "preview" as const,
    payloadJson: JSON.stringify(payload),
    evidenceJson: JSON.stringify(input.extraction),
    risksJson: JSON.stringify(diffs),
    expectedJson: JSON.stringify({ materialCodes: input.extraction.materials.map((row) => row.code) }),
  };
  if (existing?.status === "executed") return existing;
  if (existing) {
    return prisma.actionProposal.update({ where: { id: existing.id }, data });
  }
  return prisma.actionProposal.create({
    data: {
      id: createId(),
      organizationId: input.organizationId,
      sourceDocumentId: input.sourceId,
      actionType: ACTION_TYPES.createDevelopmentProject,
      idempotencyKey,
      approvalRequired: true,
      ...data,
    },
  });
}

async function hashOfSource(sourceId: string) {
  const source = await prisma.sourceDocument.findUniqueOrThrow({ where: { id: sourceId } });
  return source.contentHash;
}

export async function chooseStyleCandidate(input: {
  organizationId: string;
  userId: string;
  role: string;
  sourceId: string;
  styleId: string;
}) {
  if (input.role !== "salesperson" && input.role !== "manager") {
    throw new Error("无权选定历史资料");
  }
  const source = await prisma.sourceDocument.findFirst({
    where: { id: input.sourceId, organizationId: input.organizationId },
    include: { jobs: { orderBy: { createdAt: "desc" }, take: 1 } },
  });
  if (!source) throw new Error("来源不存在或不属于当前组织");
  const job = source.jobs[0];
  if (!job?.outputJson) throw new Error("还没有解析结果");
  const parsed = JSON.parse(job.outputJson) as {
    extraction: Extraction;
    candidates: StyleCandidate[];
    diffs?: unknown[];
    calledLiveModel?: boolean;
    mode?: string;
  };
  const hit = parsed.candidates.find((item) => item.styleId === input.styleId);
  if (!hit) throw new Error("该历史资料不在本次候选里");
  const candidates = parsed.candidates.map((item) => ({ ...item, selected: item.styleId === input.styleId }));
  const diffs = await buildDiffs(input.styleId, parsed.extraction);
  const historical = await prisma.salesOrder.findFirst({
    where: {
      organizationId: input.organizationId,
      status: { in: ["confirmed", "completed", "in_production"] },
      lines: { some: { styleId: input.styleId } },
    },
    orderBy: { createdAt: "asc" },
  });
  const proposal = await upsertProposal({
    organizationId: input.organizationId,
    jobId: job.id,
    sourceId: source.id,
    extraction: parsed.extraction,
    selectedStyleId: input.styleId,
    historicalOrderId: historical?.id ?? null,
    historicalPo: historical?.externalCustomerPo ?? null,
    diffs,
  });
  await prisma.aiJob.update({
    where: { id: job.id },
    data: {
      status: "needs_review",
      outputJson: JSON.stringify({
        ...parsed,
        candidates,
        diffs,
        selectedStyleId: input.styleId,
      }),
    },
  });
  await writeAudit({
    organizationId: input.organizationId,
    actorUserId: input.userId,
    action: "source.style_candidate_chosen",
    entityType: "SourceDocument",
    entityId: source.id,
    summary: `选定历史资料 ${hit.code}，只建引用，必须重确认`,
  });
  return {
    proposal,
    candidates,
    diffs,
    tasks: buildHandleTasks({ extraction: parsed.extraction, candidates, proposal }),
  };
}

export async function getReview(organizationId: string, sourceId: string) {
  const source = await prisma.sourceDocument.findFirst({
    where: { id: sourceId, organizationId },
    include: {
      fragments: true,
      jobs: { orderBy: { createdAt: "desc" }, take: 1 },
      proposals: { orderBy: { createdAt: "desc" }, take: 1, include: { execution: true } },
    },
  });
  if (!source) throw new Error("来源不存在或不属于当前组织");
  const job = source.jobs[0] ?? null;
  const parsed = job?.outputJson ? JSON.parse(job.outputJson) : null;
  const proposal = source.proposals[0] ?? null;
  const styleId = proposal ? (JSON.parse(proposal.expectedJson) as { styleId?: string }).styleId : null;
  const style = styleId
    ? await prisma.style.findFirst({
        where: { id: styleId, organizationId },
        include: { versions: { orderBy: { versionNumber: "asc" } } },
      })
    : null;
  const candidates = (parsed?.candidates ?? []) as StyleCandidate[];
  const orderId = await resolveReviewOrderId(organizationId, sourceId, proposal);
  const orderTasks = orderId
    ? await prisma.taskItem.findMany({
        where: { organizationId, relatedOrderId: orderId },
        select: { kind: true, status: true },
      })
    : [];
  return {
    source,
    job,
    parsed,
    proposal,
    style,
    fileHref: source.storagePath ? `/api/inbox/${source.id}/file` : null,
    tasks: buildHandleTasks({
      extraction: parsed?.extraction ?? null,
      candidates,
      proposal,
      orderId,
      orderTasks,
    }),
  };
}

async function resolveReviewOrderId(
  organizationId: string,
  sourceId: string,
  proposal: { execution?: { resultJson: string } | null } | null,
) {
  const raw = proposal?.execution?.resultJson;
  if (raw) {
    try {
      const result = JSON.parse(raw) as { orderId?: unknown };
      if (typeof result.orderId === "string" && result.orderId) return result.orderId;
    } catch {
      /* fall through */
    }
  }
  const order = await prisma.salesOrder.findFirst({
    where: { organizationId, sourceDocumentId: sourceId },
    select: { id: true },
  });
  return order?.id ?? null;
}

export async function writeAudit(input: {
  id?: string;
  organizationId: string;
  actorUserId?: string | null;
  action: string;
  entityType: string;
  entityId: string;
  summary: string;
  payloadJson?: string;
}, client: Pick<Prisma.TransactionClient, "auditEvent"> = prisma) {
  await client.auditEvent.create({
    data: {
      id: input.id ?? createId(),
      organizationId: input.organizationId,
      actorUserId: input.actorUserId ?? null,
      actorType: input.actorUserId ? "user" : "system",
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      summary: input.summary,
      payloadJson: input.payloadJson ?? null,
    },
  });
}

export function historicalOrderId() {
  return IDS.orderHistorical;
}
