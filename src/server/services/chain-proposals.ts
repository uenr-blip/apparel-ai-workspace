import { prisma } from "@/lib/db";
import { createId, sha256 } from "@/lib/hash";
import { leftoverNextStep } from "@/server/domain/leftover-next";
import {
  adoptedProposalTitle,
  evaluateChainProposals,
  explainChainProposalGap,
  type ChainProposalDraft,
} from "@/server/domain/chain-proposals";
import { getOrderMaterialSupply } from "@/server/services/order-material-supply";
import { getOrderMoney } from "@/server/services/order-money";
import { getProductionGate } from "@/server/services/production-gate";
import { getPurchaseOptions } from "@/server/services/purchase-options";

export class ChainProposalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChainProposalError";
  }
}

export type ChainProposalView = {
  id: string;
  kind: string;
  actionType: string;
  title: string;
  status: string;
  href: string;
  evidence: string[];
};

function chainKey(organizationId: string, orderId: string, draft: ChainProposalDraft) {
  const materialId = typeof draft.payload.materialId === "string" ? draft.payload.materialId : "";
  const currency = typeof draft.payload.currency === "string" ? draft.payload.currency : "";
  return `chain:${organizationId}:${orderId}:${draft.kind}:${materialId || currency || "order"}`;
}

async function ensureChainSource(organizationId: string, orderId: string, orderNo: string) {
  const contentHash = sha256(`order-chain:${organizationId}:${orderId}`);
  const rawText = [
    `本单链上规则提案 ${orderNo}。`,
    "依据是本单料况、余料方案和已确认收付，不是图片识别，也不是效益估算。",
    "正式采购与真付款未下达。调拨不是领用。登记不是银行执行。",
  ].join("");
  const existing = await prisma.sourceDocument.findUnique({
    where: { organizationId_contentHash: { organizationId, contentHash } },
  });
  const source =
    existing ??
    (await prisma.sourceDocument.create({
      data: {
        id: createId(),
        organizationId,
        contentHash,
        origin: "order_chain",
        mimeType: "text/plain",
        rawText,
        receivedAt: new Date(),
        parseStatus: "succeeded",
      },
    }));
  const job =
    (await prisma.aiJob.findFirst({
      where: { organizationId, sourceDocumentId: source.id, provider: "rules" },
      orderBy: { createdAt: "desc" },
    })) ??
    (await prisma.aiJob.create({
      data: {
        id: createId(),
        organizationId,
        sourceDocumentId: source.id,
        mode: "mock",
        provider: "rules",
        status: "succeeded",
        outputJson: JSON.stringify({ kind: "order_chain", orderId }),
      },
    }));
  return { source, job };
}

export async function syncOrderChainProposals(organizationId: string, orderId: string): Promise<ChainProposalView[]> {
  const order = await prisma.salesOrder.findFirst({
    where: { id: orderId, organizationId },
    include: { production: true },
  });
  if (!order) throw new ChainProposalError("订单不存在或不属于当前组织");

  const started = order.production.some((row) => row.kind === "started" && row.quantity > 0);
  const [purchase, supply, gate, money] = await Promise.all([
    getPurchaseOptions(organizationId, orderId),
    getOrderMaterialSupply(organizationId, { id: orderId, factoryId: order.factoryId, started }),
    getProductionGate(organizationId, orderId),
    getOrderMoney(organizationId, orderId),
  ]);
  const leftover = leftoverNextStep({
    started,
    comparable: purchase.lines.length > 0,
    freeStock: purchase.lines[0]?.freeStock ?? "0",
    adopted: purchase.adopted,
  });
  const firstLine = purchase.lines[0] ?? null;
  const drafts = evaluateChainProposals({
    orderId,
    started,
    shipped: order.status === "completed" || order.productionReadiness === "shipped",
    leftover,
    leftoverSnapshot: firstLine?.snapshot ?? null,
    leftoverMaterialId: firstLine?.materialId ?? null,
    cutLines: supply.lines,
    moneyOpen: money.lines.map((line) => ({
      currency: line.currency,
      receivableOpen: line.receivableOpen,
      payableOpen: line.payableOpen,
    })),
    gateReady: gate.ready,
    alreadyReleased: gate.alreadyReleased,
  });

  const { source, job } = await ensureChainSource(organizationId, orderId, order.orderNo);
  const wanted = new Map(drafts.map((draft) => [chainKey(organizationId, orderId, draft), draft]));
  const existing = await prisma.actionProposal.findMany({
    where: { organizationId, sourceDocumentId: source.id },
  });

  for (const row of existing) {
    const expected = (() => {
      try {
        return JSON.parse(row.expectedJson) as { fingerprint?: string; chainKey?: string };
      } catch {
        return {};
      }
    })();
    const key = expected.chainKey ?? row.idempotencyKey;
    const draft = wanted.get(key);
    if (row.status !== "preview") continue;
    if (!draft || draft.fingerprint !== expected.fingerprint) {
      await prisma.actionProposal.update({ where: { id: row.id }, data: { status: "expired" } });
    }
  }

  const views: ChainProposalView[] = [];
  for (const draft of drafts) {
    const idempotencyKey = chainKey(organizationId, orderId, draft);
    const payload = {
      ...draft.payload,
      title: draft.title,
      href: draft.href,
      willCreate: draft.willCreate,
      willNotChange: draft.willNotChange,
    };
    const expected = {
      orderId,
      chainKind: draft.kind,
      chainKey: idempotencyKey,
      fingerprint: draft.fingerprint,
      leftoverSnapshot: draft.payload.expectedSnapshot ?? null,
      optionCode: draft.payload.optionCode ?? null,
      materialId: draft.payload.materialId ?? null,
    };
    const data = {
      aiJobId: job.id,
      status: "preview" as const,
      payloadJson: JSON.stringify(payload),
      evidenceJson: JSON.stringify({ facts: draft.evidence, mode: "rules" }),
      risksJson: JSON.stringify(draft.risks),
      expectedJson: JSON.stringify(expected),
    };
    const found = existing.find((row) => row.idempotencyKey === idempotencyKey);
    if (found?.status === "executed") {
      const option = typeof draft.payload.optionCode === "string" ? draft.payload.optionCode : "";
      views.push({
        id: found.id,
        kind: draft.kind,
        actionType: found.actionType,
        title: option ? adoptedProposalTitle(option) : draft.title,
        status: found.status,
        href: draft.href,
        evidence: [...draft.evidence, "未下达正式采购"],
      });
      continue;
    }
    const saved = found
      ? await prisma.actionProposal.update({
          where: { id: found.id },
          data: { ...data, actionType: draft.actionType },
        })
      : await prisma.actionProposal.create({
          data: {
            id: createId(),
            organizationId,
            sourceDocumentId: source.id,
            actionType: draft.actionType,
            idempotencyKey,
            approvalRequired: true,
            ...data,
          },
        });
    views.push({
      id: saved.id,
      kind: draft.kind,
      actionType: saved.actionType,
      title: draft.title,
      status: saved.status,
      href: draft.href,
      evidence: draft.evidence,
    });
  }

  for (const row of existing) {
    if (row.status !== "executed" || row.actionType !== "adopt_purchase_option") continue;
    if (views.some((item) => item.id === row.id)) continue;
    const payload = (() => {
      try {
        return JSON.parse(row.payloadJson) as { optionCode?: string; href?: string; title?: string };
      } catch {
        return {};
      }
    })();
    const option = payload.optionCode === "A" || payload.optionCode === "B" ? payload.optionCode : "";
    views.push({
      id: row.id,
      kind: option === "B" ? "adopt_buy" : "adopt_leftover",
      actionType: row.actionType,
      title: option ? adoptedProposalTitle(option) : "已采用采购草稿，未下达采购",
      status: row.status,
      href: typeof payload.href === "string" ? payload.href : `/orders/${orderId}#leftover-plan`,
      evidence: ["采购仍是草稿", "未下达正式采购"],
    });
  }

  return views;
}

export async function listOrderChainProposals(organizationId: string, orderId: string) {
  const proposals = await syncOrderChainProposals(organizationId, orderId);
  const order = await prisma.salesOrder.findFirst({
    where: { id: orderId, organizationId },
    include: { production: true },
  });
  if (!order) throw new ChainProposalError("订单不存在或不属于当前组织");
  const started = order.production.some((row) => row.kind === "started" && row.quantity > 0);
  const [purchase, money] = await Promise.all([
    getPurchaseOptions(organizationId, orderId),
    getOrderMoney(organizationId, orderId),
  ]);
  const leftover = leftoverNextStep({
    started,
    comparable: purchase.lines.length > 0,
    freeStock: purchase.lines[0]?.freeStock ?? "0",
    adopted: purchase.adopted,
  });
  const reasons = explainChainProposalGap({
    shipped: order.status === "completed" || order.productionReadiness === "shipped",
    leftover,
    comparable: purchase.lines.length > 0,
    hasOpenMoney: money.lines.some((line) => Number(line.receivableOpen) > 0 || Number(line.payableOpen) > 0),
    openKinds: proposals.filter((row) => row.status === "preview").map((row) => row.kind),
  });
  return { proposals, reasons };
}
