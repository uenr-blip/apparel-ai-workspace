import { ACTION_TYPES } from "@/lib/constants";
import { INTAKE_WORKFLOW } from "@/lib/customer-intake";
import { prisma } from "@/lib/db";
import { labels } from "@/lib/labels";
import { summarizeDecision } from "@/server/services/workspace";

export class DecisionCenterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DecisionCenterError";
  }
}

function readJson(raw: string): Record<string, unknown> {
  try {
    const value = JSON.parse(raw) as unknown;
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function asString(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (value && typeof value === "object" && "value" in value) {
    const inner = (value as { value: unknown }).value;
    return typeof inner === "string" && inner.trim() ? inner.trim() : null;
  }
  return null;
}

function asList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

export async function expireIfStale(organizationId: string, proposalId: string) {
  const proposal = await prisma.actionProposal.findFirst({
    where: { id: proposalId, organizationId },
  });
  if (!proposal || proposal.status !== "preview") return proposal;
  const expected = readJson(proposal.expectedJson);
  if (proposal.actionType === ACTION_TYPES.createOrderDraft && typeof expected.styleId === "string") {
    const current = await prisma.styleVersion.findFirst({
      where: { styleId: expected.styleId, status: "approved" },
      orderBy: { versionNumber: "desc" },
    });
    const expectedVersionId = typeof expected.approvedVersionId === "string" ? expected.approvedVersionId : null;
    if (expectedVersionId && current && current.id !== expectedVersionId) {
      return prisma.actionProposal.update({
        where: { id: proposal.id },
        data: { status: "expired" },
      });
    }
  }
  if (proposal.actionType === ACTION_TYPES.createDevelopmentProject) {
    const codes = asList(expected.materialCodes);
    if (codes.length) {
      const found = await prisma.material.findMany({
        where: { organizationId, code: { in: codes } },
        select: { code: true },
      });
      if (found.length !== codes.length) {
        return prisma.actionProposal.update({
          where: { id: proposal.id },
          data: { status: "expired" },
        });
      }
    }
  }
  if (typeof expected.chainKind === "string") {
    const stale = await chainProposalStale(organizationId, proposal.actionType, expected);
    if (stale) {
      return prisma.actionProposal.update({
        where: { id: proposal.id },
        data: { status: "expired" },
      });
    }
  }
  return proposal;
}

async function chainProposalStale(
  organizationId: string,
  actionType: string,
  expected: Record<string, unknown>,
) {
  const orderId = asString(expected.orderId);
  if (!orderId) return true;
  if (actionType === ACTION_TYPES.releaseToProduction) {
    const { getProductionGate } = await import("@/server/services/production-gate");
    const gate = await getProductionGate(organizationId, orderId);
    return !gate.ready || gate.alreadyReleased || gate.alreadyDone;
  }
  if (actionType === ACTION_TYPES.adoptPurchaseOption) {
    const { getPurchaseOptions } = await import("@/server/services/purchase-options");
    const { leftoverNextStep } = await import("@/server/domain/leftover-next");
    const order = await prisma.salesOrder.findFirst({
      where: { id: orderId, organizationId },
      include: { production: true },
    });
    const started = order?.production.some((row) => row.kind === "started" && row.quantity > 0) ?? false;
    const purchase = await getPurchaseOptions(organizationId, orderId);
    const leftover = leftoverNextStep({
      started,
      comparable: purchase.lines.length > 0,
      freeStock: purchase.lines[0]?.freeStock ?? "0",
      adopted: purchase.adopted,
    });
    const optionCode = asString(expected.optionCode);
    const snapshot = asString(expected.leftoverSnapshot);
    const open = leftover.kind === "ready" || leftover.kind === "stale";
    return !open || leftover.recommend !== optionCode || (snapshot != null && purchase.lines[0]?.snapshot !== snapshot);
  }
  return false;
}

export async function getDecisionRecord(organizationId: string, proposalId: string) {
  await expireIfStale(organizationId, proposalId);
  const proposal = await prisma.actionProposal.findFirst({
    where: { id: proposalId, organizationId },
    include: { execution: true, source: true },
  });
  if (!proposal) throw new DecisionCenterError("提案不存在或不属于当前组织");

  const payload = readJson(proposal.payloadJson);
  const evidence = readJson(proposal.evidenceJson);
  const expected = readJson(proposal.expectedJson);
  const risksRaw = (() => {
    try {
      const value = JSON.parse(proposal.risksJson) as unknown;
      return Array.isArray(value) ? value : [];
    } catch {
      return [];
    }
  })();
  const styleId = typeof expected.styleId === "string" ? expected.styleId : asString(payload.selectedStyleId);
  const style = styleId
    ? await prisma.style.findFirst({ where: { id: styleId, organizationId } })
    : null;
  const result = proposal.execution ? readJson(proposal.execution.resultJson) : {};
  const orderId =
    asString(result.orderId) ?? asString(expected.orderId) ?? asString(payload.orderId);
  const projectId = typeof result.projectId === "string" ? result.projectId : null;
  const audits = await prisma.auditEvent.findMany({
    where: {
      organizationId,
      OR: [
        { entityType: "ActionProposal", entityId: proposal.id },
        orderId ? { entityType: "SalesOrder", entityId: orderId } : undefined,
        projectId ? { entityType: "DevelopmentProject", entityId: projectId } : undefined,
      ].filter(Boolean) as Array<{ entityType: string; entityId: string }>,
    },
    orderBy: { createdAt: "desc" },
    take: 8,
  });

  const evidenceLines = [
    asString(evidence.styleCode) ? `款号 ${asString(evidence.styleCode)}` : null,
    asString(evidence.customerName) ? `客户 ${asString(evidence.customerName)}` : null,
    asString(payload.customerCodeHint),
    Array.isArray(evidence.unknowns) && evidence.unknowns.length ? `未知 ${evidence.unknowns.join("、")}` : null,
    ...asList(evidence.facts),
  ].filter((item): item is string => Boolean(item));

  const staleReason =
    proposal.status === "expired"
      ? proposal.actionType === ACTION_TYPES.createDevelopmentProject
        ? "候选材料已变，提案已过期，请重新预览"
        : typeof expected.chainKind === "string"
          ? "本单料况或门槛已变，提案已过期"
          : "资料版本已变，提案已过期，请重新预览"
      : null;

  return {
    id: proposal.id,
    actionType: proposal.actionType,
    actionLabel: labels.actionType(proposal.actionType),
    status: proposal.status,
    statusLabel: labels.proposalStatus(proposal.status),
    idempotencyKey: proposal.idempotencyKey,
    reviewInInbox: payload.workflow === INTAKE_WORKFLOW,
    sourcePreview: proposal.source.rawText.slice(0, 180),
    willCreate: asList(payload.willCreate),
    willNotChange: asList(payload.willNotChange),
    evidenceLines,
    risks: risksRaw
      .map((row) => {
        if (!row || typeof row !== "object") return null;
        const item = row as { field?: unknown; impact?: unknown; incoming?: unknown };
        const field = typeof item.field === "string" ? item.field : "";
        const impact = typeof item.impact === "string" ? item.impact : "";
        const incoming = typeof item.incoming === "string" ? item.incoming : "";
        return field ? { field, impact, incoming } : null;
      })
      .filter((row): row is { field: string; impact: string; incoming: string } => Boolean(row)),
    staleReason,
    links: {
      inbox: `/inbox/${proposal.sourceDocumentId}`,
      style: style ? `/styles/${style.id}` : null,
      order: orderId ? `/orders/${orderId}` : null,
      project: projectId ? `/projects/${projectId}` : null,
    },
    executionStatus: proposal.execution ? labels.executionStatus(proposal.execution.status) : null,
    audits: audits.map((row) => ({ id: row.id, summary: row.summary, createdAt: row.createdAt.toISOString() })),
  };
}

export function decisionSourceExcerpt(raw: string) {
  const body = raw
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("[") && !line.startsWith("来源：") && !line.startsWith("接收时间："))
    .join(" ");
  const compact = (body || raw).replace(/\s+/g, " ").trim();
  if (!compact) return "";
  return compact.length > 72 ? `${compact.slice(0, 72)}…` : compact;
}

export function decisionSourceWhen(date: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const pick = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return `${pick("month")}月${pick("day")}日 ${pick("hour")}:${pick("minute")}:${pick("second")}`;
}

export async function listDecisions(organizationId: string, input: { status?: string; q?: string } = {}) {
  const status = input.status && input.status !== "all" ? input.status : undefined;
  const rows = await prisma.actionProposal.findMany({
    where: { organizationId, ...(status ? { status } : {}) },
    include: { source: true, execution: true },
    orderBy: { createdAt: "desc" },
    take: 80,
  });
  const refreshed = [];
  for (const row of rows) {
    const next = await expireIfStale(organizationId, row.id);
    const statusNow = next?.status ?? row.status;
    if (status && statusNow !== status) continue;
    refreshed.push({ ...row, status: statusNow });
  }
  const q = input.q?.trim().toLowerCase();
  return refreshed
    .filter((row) => {
      if (!q) return true;
      const excerpt = decisionSourceExcerpt(row.source.rawText);
      const when = decisionSourceWhen(row.source.receivedAt);
      return [labels.actionType(row.actionType), row.actionType, row.idempotencyKey, labels.proposalStatus(row.status), excerpt, when, row.source.rawText].some(
        (item) => item.toLowerCase().includes(q),
      );
    })
    .map((row) => ({
      id: row.id,
      href: `/decisions/${row.id}`,
      actionLabel: labels.actionType(row.actionType),
      detail: summarizeDecision(row).detail,
      when: decisionSourceWhen(row.source.receivedAt),
      excerpt: decisionSourceExcerpt(row.source.rawText),
      sourceMark: row.source.id.slice(-6),
      status: row.status,
      statusLabel: labels.proposalStatus(row.status),
      idempotencyKey: row.idempotencyKey,
    }));
}
