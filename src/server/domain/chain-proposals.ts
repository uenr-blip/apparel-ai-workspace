import { ACTION_TYPES } from "@/lib/constants";
import { d } from "@/server/domain/procurement";
import type { LeftoverNext } from "@/server/domain/leftover-next";

export type ChainProposalKind =
  | "adopt_leftover"
  | "adopt_buy"
  | "transfer"
  | "consume"
  | "over_use"
  | "collect"
  | "release";

export type ChainProposalDraft = {
  kind: ChainProposalKind;
  actionType: string;
  title: string;
  evidence: string[];
  fingerprint: string;
  href: string;
  payload: Record<string, unknown>;
  risks: Array<{ field: string; impact: string; incoming: string }>;
  willCreate: string[];
  willNotChange: string[];
};

export type ChainCutLine = {
  materialId: string;
  materialCode: string;
  blocker: string | null;
  companyOnHand: string;
  atFactory: string;
  consumed: string;
  remaining: string | null;
  gross: string | null;
};

function draft(input: Omit<ChainProposalDraft, "fingerprint"> & { fingerprint?: string }): ChainProposalDraft {
  const fingerprint = input.fingerprint ?? `${input.kind}:${input.evidence.join("|")}`;
  return { ...input, fingerprint };
}

export function evaluateChainProposals(input: {
  orderId: string;
  started: boolean;
  shipped: boolean;
  leftover: LeftoverNext;
  leftoverSnapshot: string | null;
  leftoverMaterialId: string | null;
  cutLines: ChainCutLine[];
  moneyOpen: Array<{ currency: string; receivableOpen: string; payableOpen: string }>;
  gateReady: boolean;
  alreadyReleased: boolean;
}): ChainProposalDraft[] {
  if (input.shipped) return [];

  const next: ChainProposalDraft[] = [];
  const leftoverOpen = input.leftover.kind === "ready" || input.leftover.kind === "stale";

  for (const line of input.cutLines) {
    if (!line.gross || line.remaining === null) continue;
    if (d(line.consumed).gt(line.gross)) {
      next.push(
        draft({
          kind: "over_use",
          actionType: ACTION_TYPES.createInternalTask,
          title: `${line.materialCode} 领用超过本单毛需求`,
          evidence: [`${line.materialCode} 已领 ${line.consumed}，毛需求 ${line.gross}`],
          href: `/orders/${input.orderId}#material-supply`,
          payload: { orderId: input.orderId, taskKind: "chain_over_use", materialId: line.materialId },
          risks: [{ field: "领用", impact: "只建内部任务，不改库存数", incoming: line.consumed }],
          willCreate: ["内部核对任务"],
          willNotChange: ["库存批次", "正式采购"],
        }),
      );
    }
  }

  if (leftoverOpen && input.leftover.recommend === "A" && input.leftoverMaterialId && input.leftoverSnapshot) {
    next.push(
      draft({
        kind: "adopt_leftover",
        actionType: ACTION_TYPES.adoptPurchaseOption,
        title: "采用余料方案 A，占住可分配库存",
        evidence: [input.leftover.label],
        fingerprint: `adopt_leftover:${input.leftoverMaterialId}:${input.leftoverSnapshot}:${input.leftover.kind}`,
        href: `/orders/${input.orderId}#leftover-plan`,
        payload: {
          orderId: input.orderId,
          materialId: input.leftoverMaterialId,
          optionCode: "A",
          expectedSnapshot: input.leftoverSnapshot,
        },
        risks: [{ field: "余料", impact: "采用后占住，不下正式采购", incoming: "A" }],
        willCreate: ["库存占用", "采购草稿"],
        willNotChange: ["正式采购单", "款式主档"],
      }),
    );
  }

  if (!input.started) {
    for (const line of input.cutLines.filter((item) => item.blocker === "未调到厂")) {
      next.push(
        draft({
          kind: "transfer",
          actionType: ACTION_TYPES.createInternalTask,
          title: `${line.materialCode} 该调到厂`,
          evidence: [`${line.materialCode} 公司在手 ${line.companyOnHand}，厂里 ${line.atFactory}，未调到厂`],
          href: `/orders/${input.orderId}#material-supply`,
          payload: { orderId: input.orderId, taskKind: "chain_transfer", materialId: line.materialId },
          risks: [{ field: "调拨", impact: "只建任务，不自动调拨。调拨不是领用", incoming: line.atFactory }],
          willCreate: ["内部核对任务"],
          willNotChange: ["库存批次", "正式采购"],
        }),
      );
    }
  }

  if (input.started) {
    for (const line of input.cutLines) {
      if (line.remaining === null) continue;
      if (d(line.atFactory).gt(0) && d(line.consumed).eq(0) && d(line.remaining).gt(0)) {
        next.push(
          draft({
            kind: "consume",
            actionType: ACTION_TYPES.createInternalTask,
            title: `${line.materialCode} 已调到厂尚未领用`,
            evidence: [`${line.materialCode} 厂里 ${line.atFactory}，已领 0`],
            href: `/orders/${input.orderId}#material-supply`,
            payload: { orderId: input.orderId, taskKind: "chain_consume", materialId: line.materialId },
            risks: [{ field: "领用", impact: "只建任务，不自动扣数。调拨不是领用", incoming: line.atFactory }],
            willCreate: ["内部核对任务"],
            willNotChange: ["库存批次"],
          }),
        );
      }
    }
  }

  if (leftoverOpen && input.leftover.recommend === "B" && input.leftoverMaterialId && input.leftoverSnapshot) {
    next.push(
      draft({
        kind: "adopt_buy",
        actionType: ACTION_TYPES.adoptPurchaseOption,
        title: "确认补购方案 B，生成采购草稿",
        evidence: [input.leftover.label],
        fingerprint: `adopt_buy:${input.leftoverMaterialId}:${input.leftoverSnapshot}:${input.leftover.kind}`,
        href: `/orders/${input.orderId}#leftover-plan`,
        payload: {
          orderId: input.orderId,
          materialId: input.leftoverMaterialId,
          optionCode: "B",
          expectedSnapshot: input.leftoverSnapshot,
        },
        risks: [{ field: "采购", impact: "只生成草稿，不下正式采购，也不编效益", incoming: "B" }],
        willCreate: ["采购草稿"],
        willNotChange: ["正式采购单", "银行付款"],
      }),
    );
  }

  for (const row of input.moneyOpen) {
    const recv = d(row.receivableOpen);
    const pay = d(row.payableOpen);
    if (recv.lte(0) && pay.lte(0)) continue;
    next.push(
      draft({
        kind: "collect",
        actionType: ACTION_TYPES.createInternalTask,
        title: "核对本单未结收付",
        evidence: [`${row.currency} 还欠客户 ${row.receivableOpen}，还欠供应/厂 ${row.payableOpen}`],
        href: `/orders/${input.orderId}#order-money`,
        payload: { orderId: input.orderId, taskKind: "chain_collect", currency: row.currency },
        risks: [{ field: "收付", impact: "只建核对任务，不是银行执行", incoming: row.currency }],
        willCreate: ["内部核对任务"],
        willNotChange: ["银行余额", "总账凭证"],
      }),
    );
  }

  if (input.gateReady && !input.alreadyReleased) {
    next.push(
      draft({
        kind: "release",
        actionType: ACTION_TYPES.releaseToProduction,
        title: "门槛已齐，可批准投产",
        evidence: ["资料批准、分色确认、厂里有可用料已齐"],
        href: `/orders/${input.orderId}#production-gate`,
        payload: { orderId: input.orderId },
        risks: [{ field: "投产", impact: "批准后才能登记产量。色、手感、版型不自动终审", incoming: "" }],
        willCreate: ["投产放行"],
        willNotChange: ["正式采购", "历史已批准资料"],
      }),
    );
  }

  return next;
}

export function explainChainProposalGap(input: {
  shipped: boolean;
  leftover: LeftoverNext;
  comparable: boolean;
  hasOpenMoney: boolean;
  openKinds: string[];
}): string[] {
  if (input.openKinds.length) return [];
  if (input.shipped) return ["已出运，不再提案"];
  const reasons: string[] = [];
  if (input.leftover.kind === "adopted") {
    reasons.push(input.leftover.label);
  } else if (input.leftover.kind === "blocked" || !input.comparable) {
    reasons.push("还不能比较余料：没有已确认面辅料需求或缺少报价");
  }
  if (!input.hasOpenMoney) reasons.push("没有未结收付");
  if (!reasons.length) reasons.push("这单暂时没有缺料、占余料、对不上或该收付的提案");
  return reasons;
}

export function adoptedProposalTitle(optionCode: string) {
  return `已采用方案 ${optionCode}，采购草稿，未下达采购`;
}
