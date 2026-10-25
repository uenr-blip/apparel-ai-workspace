import { prisma } from "@/lib/db";
import { isDeskOrder } from "@/server/domain/desk-orders";
import { labels } from "@/lib/labels";
import { INTAKE_WORKFLOW } from "@/lib/customer-intake";
import { blockingTaskHref } from "@/lib/task-href";
import { searchKnowledge } from "@/server/services/reuse";
import { ledgerPermissions } from "@/server/services/ledger-db";
import { tradePermissions } from "@/server/services/trade-db";
import { canUserAction } from "@/server/services/user-permissions";
import type { TradeActor } from "@/server/services/trade-contract";

export const WORKSPACE_PREVIEW_LIMIT = 8;
const REUSE_LIMIT = 6;

export type WorkspaceBlockGroup = {
  key: string;
  href: string;
  orderNo: string | null;
  styleCode: string | null;
  kinds: string[];
  titles: string[];
  links: Array<{ title: string; href: string }>;
  repeatCount: number;
};

export type WorkspaceListItem = {
  id: string;
  href: string;
  title: string;
  detail: string;
};

export type WorkspaceReuseItem = {
  id: string;
  kind: "style" | "material";
  href: string;
  code: string;
  name: string;
  imagePath: string | null;
  matchLabel: "资料匹配";
  matchReasons: string[];
  sourceLabel: string;
  historicalApprovalReusable: false;
};

function readJson(raw: string): Record<string, unknown> {
  try {
    const value = JSON.parse(raw) as unknown;
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function nestedText(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (value && typeof value === "object" && "value" in value) {
    const inner = (value as { value: unknown }).value;
    return typeof inner === "string" && inner.trim() ? inner.trim() : null;
  }
  return null;
}

function joinParts(parts: Array<string | null | undefined>) {
  return parts.filter((part): part is string => Boolean(part && part.trim())).join(" · ");
}

export function summarizeDecision(input: {
  id: string;
  actionType: string;
  sourceDocumentId: string;
  payloadJson: string;
  evidenceJson: string;
}): WorkspaceListItem {
  const payload = readJson(input.payloadJson);
  if (payload.workflow === INTAKE_WORKFLOW) {
    const draft = payload.draft as { title?: unknown; po?: unknown } | undefined;
    return {
      id: input.id,
      href: `/inbox/${input.sourceDocumentId}`,
      title: "客户 PO 待核对",
      detail: joinParts([nestedText(draft?.title), nestedText(draft?.po)]) || "打开表格，补齐后确认建跟单",
    };
  }
  const evidence = readJson(input.evidenceJson);
  const customer =
    nestedText(payload.customerCodeHint) ?? nestedText(payload.customerName) ?? nestedText(evidence.customerName);
  const styleCode = nestedText(evidence.styleCode);
  const intent = nestedText(evidence.intent);
  const isDev = input.actionType === "create_development_project";
  const detail = joinParts([
    customer,
    styleCode,
    isDev && !styleCode ? "材料先行，尚无款号" : null,
    intent ? labels.intent(intent) : null,
  ]);

  return {
    id: input.id,
    href: `/decisions/${input.id}`,
    title: labels.actionType(input.actionType),
    detail: detail || "打开提案详情，核对依据后再批准",
  };
}

export function collapseDeskDecisions(items: WorkspaceListItem[]): WorkspaceListItem[] {
  const groups: WorkspaceListItem[] = [];
  const index = new Map<string, { item: WorkspaceListItem; base: string; count: number }>();
  for (const item of items) {
    const key = `${item.title}\n${item.detail}`;
    const existing = index.get(key);
    if (!existing) {
      const copy = { ...item };
      index.set(key, { item: copy, base: item.detail, count: 1 });
      groups.push(copy);
      continue;
    }
    existing.count += 1;
    existing.item.detail = `${existing.base} · 共 ${existing.count} 份`;
    existing.item.href = "/decisions?status=preview";
  }
  return groups;
}

function looseTaskHref(kind: string) {
  if (kind === "material_test_pending" || kind === "development_review") return "/styles?tab=projects";
  return "/orders";
}

export function summarizeProcessed(input: {
  id: string;
  actionType: string;
  sourceDocumentId: string;
  status: string;
  resultJson: string;
}): WorkspaceListItem {
  const result = readJson(input.resultJson);
  const target =
    nestedText(result.orderNo) ?? nestedText(result.projectCode) ?? (typeof result.projectId === "string" ? result.projectId : null);

  return {
    id: input.id,
    href: `/inbox/${input.sourceDocumentId}`,
    title: labels.actionType(input.actionType),
    detail: joinParts([target, labels.executionStatus(input.status)]),
  };
}

export async function getWorkspaceSnapshot(organizationId: string, viewer?: TradeActor) {
  const hidden = new Set(["GeneralLedger", "Treasury", "TradeLedger", "FactoryReconDraft", "MaterialLedger"]);
  let canOpenFinance = false;
  if (viewer?.organizationId === organizationId) {
    const valid = await prisma.user.findFirst({ where: { id: viewer.userId, organizationId, role: viewer.role, active: true }, select: { id: true } });
    if (valid) {
      const [ledger, trade, recon] = await Promise.all([ledgerPermissions(viewer), tradePermissions(viewer), canUserAction(viewer, "generate_factory_recon")]);
      if (ledger.has("ledger_view")) hidden.delete("GeneralLedger");
      if (trade.has("trade_view")) for (const entity of ["Treasury", "TradeLedger", "MaterialLedger"]) hidden.delete(entity);
      if (recon) hidden.delete("FactoryReconDraft");
      canOpenFinance = ledger.has("ledger_view") || trade.has("trade_view") || recon;
    }
  }
  const [processedRows, processedTotal, decisionRows, decisionTotal, blocks, audits] = await Promise.all([
    prisma.actionExecution.findMany({
      where: { proposal: { organizationId } },
      include: { proposal: true },
      orderBy: { createdAt: "desc" },
      take: WORKSPACE_PREVIEW_LIMIT,
    }),
    prisma.actionExecution.count({ where: { proposal: { organizationId } } }),
    prisma.actionProposal.findMany({
      where: { organizationId, status: "preview" },
      orderBy: { createdAt: "desc" },
      take: WORKSPACE_PREVIEW_LIMIT,
    }),
    prisma.actionProposal.count({ where: { organizationId, status: "preview" } }),
    prisma.taskItem.findMany({
      where: { organizationId, status: "open", blocking: true },
      include: { order: { include: { purchaseDrafts: { select: { id: true }, take: 1 } } }, style: true },
      orderBy: { createdAt: "desc" },
    }),
    prisma.auditEvent.findMany({
      where: { organizationId, entityType: { notIn: [...hidden] } },
      orderBy: { createdAt: "desc" },
      take: 10,
    }),
  ]);

  const deskBlocks = blocks.filter((task) => {
    if (!task.order) return true;
    return isDeskOrder({
      status: task.order.status,
      orderNo: task.order.orderNo,
      hasPurchaseDraft: task.order.purchaseDrafts.length > 0,
    });
  });
  const grouped = groupBlockingTasks(deskBlocks);
  const reuse = await findReuseOpportunities(organizationId, decisionRows);

  return {
    processed: processedRows.map((row) =>
      summarizeProcessed({
        id: row.id,
        actionType: row.proposal.actionType,
        sourceDocumentId: row.proposal.sourceDocumentId,
        status: row.status,
        resultJson: row.resultJson,
      }),
    ),
    processedTotal,
    decisions: collapseDeskDecisions(
      decisionRows.map((row) =>
        summarizeDecision({
          id: row.id,
          actionType: row.actionType,
          sourceDocumentId: row.sourceDocumentId,
          payloadJson: row.payloadJson,
          evidenceJson: row.evidenceJson,
        }),
      ),
    ),
    decisionTotal,
    blockTotal: blocks.length,
    blockOrderTotal: grouped.length,
    blockGroups: grouped.slice(0, WORKSPACE_PREVIEW_LIMIT),
    reuse,
    audits,
    finance: canOpenFinance ? { href: "/finance" } : null,
  };
}

export function groupBlockingTasks(
  tasks: Array<{
    id: string;
    kind: string;
    title: string;
    relatedOrderId: string | null;
    order: { id: string; orderNo: string } | null;
    style: { code: string } | null;
  }>,
): WorkspaceBlockGroup[] {
  const groups: WorkspaceBlockGroup[] = [];
  const index = new Map<string, WorkspaceBlockGroup>();
  for (const task of tasks) {
    const key = task.relatedOrderId ?? `loose:${task.kind}:${task.title}`;
    let group = index.get(key);
    if (!group) {
      const href = task.relatedOrderId ? blockingTaskHref(task.kind, task.relatedOrderId) : looseTaskHref(task.kind);
      group = {
        key,
        href,
        orderNo: task.order?.orderNo ?? null,
        styleCode: task.style?.code ?? null,
        kinds: [],
        titles: [],
        links: [],
        repeatCount: 0,
      };
      index.set(key, group);
      groups.push(group);
    }
    group.repeatCount += 1;
    if (!group.kinds.includes(task.kind)) group.kinds.push(task.kind);
    if (!group.titles.includes(task.title)) group.titles.push(task.title);
    const linkHref = task.relatedOrderId ? blockingTaskHref(task.kind, task.relatedOrderId) : "/orders";
    if (!group.links.some((link) => link.title === task.title && link.href === linkHref)) {
      group.links.push({ title: task.title, href: linkHref });
    }
  }
  return groups;
}

async function findReuseOpportunities(
  organizationId: string,
  pendingDecisions: Array<{ actionType: string; payloadJson: string; evidenceJson: string; sourceDocumentId: string }>,
): Promise<WorkspaceReuseItem[]> {
  const projects = await prisma.developmentProject.findMany({
    where: { organizationId, status: "open", styleId: null },
    orderBy: { createdAt: "desc" },
    take: 3,
  });

  const queries: Array<{ query: string; sourceLabel: string }> = [];
  for (const project of projects) {
    const query = project.name.trim();
    if (query) queries.push({ query, sourceLabel: project.code });
  }
  for (const proposal of pendingDecisions) {
    if (proposal.actionType !== "create_development_project") continue;
    const payload = readJson(proposal.payloadJson);
    const evidence = readJson(proposal.evidenceJson);
    const materials = Array.isArray(payload.materials)
      ? payload.materials
          .map((row) => (row && typeof row === "object" && "code" in row ? nestedText((row as { code: unknown }).code) : null))
          .filter((code): code is string => Boolean(code))
      : [];
    const query = [nestedText(evidence.customerName), nestedText(payload.customerName), ...materials]
      .filter((part): part is string => Boolean(part))
      .join(" ");
    if (query.trim()) queries.push({ query, sourceLabel: "待批准开发资料" });
  }

  const unique = [...new Map(queries.map((row) => [row.query, row])).values()].slice(0, 2);
  const seen = new Set<string>();
  const items: WorkspaceReuseItem[] = [];

  for (const entry of unique) {
    const result = await searchKnowledge({ organizationId, query: entry.query });
    for (const style of result.styles) {
      const key = `style:${style.id}`;
      if (seen.has(key) || !style.matchReasons.length) continue;
      seen.add(key);
      items.push({
        id: style.id,
        kind: "style",
        href: `/styles/${style.id}`,
        code: style.code,
        name: style.name,
        imagePath: style.imagePath,
        matchLabel: "资料匹配",
        matchReasons: style.matchReasons,
        sourceLabel: entry.sourceLabel,
        historicalApprovalReusable: false,
      });
    }
    for (const material of result.materials) {
      const key = `material:${material.id}`;
      if (seen.has(key) || !material.matchReasons.length) continue;
      seen.add(key);
      items.push({
        id: material.id,
        kind: "material",
        href: `/resources/materials/${material.id}`,
        code: material.code,
        name: material.name,
        imagePath: null,
        matchLabel: "资料匹配",
        matchReasons: material.matchReasons,
        sourceLabel: entry.sourceLabel,
        historicalApprovalReusable: false,
      });
    }
  }

  items.sort((a, b) => b.matchReasons.length - a.matchReasons.length);
  return items.slice(0, REUSE_LIMIT);
}
