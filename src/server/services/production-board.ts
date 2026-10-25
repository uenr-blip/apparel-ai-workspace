import { ACTION_TYPES } from "@/lib/constants";
import { prisma } from "@/lib/db";
import { createId } from "@/lib/hash";
import { labels } from "@/lib/labels";
import { availableFinishedGoods } from "@/server/domain/packing";
import {
  assertLinesMatchOrder,
  collectProductionLines,
  summarizeProduction,
  type ProductionColorSizeLine,
  type ProductionKind,
} from "@/server/domain/production";
import { canApproveAction, canSeeFactory } from "@/server/permissions";
import { ExecutionError } from "@/server/services/execution";
import { classifyOrderWatch, type OrderWatch } from "@/server/domain/order-watch";
import { getOrdersMaterialSupply, type OrderMaterialSupply } from "@/server/services/order-material-supply";
import { writeAudit } from "@/server/services/intake";
import { lockOrderForWrite } from "@/server/services/order-write";
import { canUserAction } from "@/server/services/user-permissions";

const SIZE_ORDER = ["XS", "S", "M", "L", "XL", "XXL"];

function qtyAt(
  production: Array<{ kind: string; lines: Array<{ colorName: string; sizeCode: string; quantity: number }> }>,
  kind: string,
  colorName: string,
  sizeCode: string,
) {
  return production
    .filter((row) => row.kind === kind)
    .flatMap((row) => row.lines)
    .filter((line) => line.colorName === colorName && line.sizeCode === sizeCode)
    .reduce((sum, line) => sum + line.quantity, 0);
}

function buildColorSize(
  lines: Array<{
    colors: Array<{ colorName: string; quantity: number; sizes: Array<{ sizeCode: string; quantity: number }> }>;
  }>,
  production: Array<{ kind: string; lines: Array<{ colorName: string; sizeCode: string; quantity: number }> }> = [],
): ProductionColorSize {
  const sizeSet = new Set<string>();
  for (const line of lines) {
    for (const color of line.colors) {
      for (const size of color.sizes) sizeSet.add(size.sizeCode);
    }
  }
  const sizeCodes = [...sizeSet].sort(
    (a, b) => (SIZE_ORDER.indexOf(a) === -1 ? 99 : SIZE_ORDER.indexOf(a)) - (SIZE_ORDER.indexOf(b) === -1 ? 99 : SIZE_ORDER.indexOf(b)) || a.localeCompare(b),
  );
  const colors = lines.flatMap((line) =>
    line.colors.map((color) => {
      const sizes: Record<string, number | null> = {};
      let filled = 0;
      for (const code of sizeCodes) {
        const qty = color.sizes.find((size) => size.sizeCode === code)?.quantity;
        sizes[code] = qty ?? null;
        if (typeof qty === "number") filled += qty;
      }
      return { colorName: color.colorName, ordered: color.quantity, filled, sizes };
    }),
  );
  const hasSizes = sizeCodes.length > 0 && colors.some((color) => color.filled > 0);
  const sizeRows = sizeCodes.length ? sizeCodes : ["整色"];
  const matrix = colors.flatMap((color) =>
    sizeRows.map((sizeCode) => {
      const ordered = sizeCode === "整色" ? color.ordered : (color.sizes[sizeCode] ?? null);
      const started = qtyAt(production, "started", color.colorName, sizeCode === "整色" ? "" : sizeCode) + qtyAt(production, "transfer_in", color.colorName, sizeCode === "整色" ? "" : sizeCode) - qtyAt(production, "transfer_out", color.colorName, sizeCode === "整色" ? "" : sizeCode);
      const good = qtyAt(production, "good", color.colorName, sizeCode === "整色" ? "" : sizeCode);
      const shipped = qtyAt(production, "shipped", color.colorName, sizeCode === "整色" ? "" : sizeCode);
      return {
        colorName: color.colorName,
        sizeCode,
        ordered,
        started,
        good,
        shipped,
        leftover: Math.max(0, good - shipped),
      };
    }),
  );
  return {
    sizeCodes,
    colors,
    matrix,
    columns: ["订单", "投产", "合格", "发运", "余货"],
    productionByProcess: false,
    note: hasSizes
      ? "这是订单色尺嵌套表。列是订单/投产/合格/发运/余货，不是开裁/车间/后整件数。产量可按本单色尺登记，合计进整单。"
      : "订单色尺未拆到尺码。有颜色时可按色登记；没有色尺时仍按整单件数。不是开裁/车间/后整。",
  };
}

const KINDS = new Set<ProductionKind>(["started", "scrapped", "wip", "good", "shipped", "rework"]);
const STAGE_ORDER: Record<string, number> = {
  leftover_unshipped: 0,
  in_progress: 1,
  not_started: 2,
  shipped: 3,
};

export type ProductionColorSize = {
  sizeCodes: string[];
  colors: Array<{
    colorName: string;
    ordered: number;
    filled: number;
    sizes: Record<string, number | null>;
  }>;
  matrix: Array<{
    colorName: string;
    sizeCode: string;
    ordered: number | null;
    started: number;
    good: number;
    shipped: number;
    leftover: number;
  }>;
  columns: string[];
  productionByProcess: false;
  note: string;
};

export type ProductionPackingCarton = {
  id: string;
  cartonNo: string;
  qty: number;
  colors: string[];
  sizeCodes: string[];
  weightStatus: string;
  netWeight: string | null;
  grossWeight: string | null;
  lines: Array<{ colorName: string; sizeCode: string; quantity: number }>;
};

export type ProductionPackingPlan = {
  id: string;
  status: string;
  total: number;
  cartons: ProductionPackingCarton[];
};

export type ProductionPacking = {
  shippedTotal: number;
  occupiedTotal: number;
  plans: ProductionPackingPlan[];
};

export const BOARD_VIEWS = [
  { id: "all", label: "全部", group: "进度" },
  { id: "not_started", label: "未投产", group: "进度" },
  { id: "in_progress", label: "生产中", group: "进度" },
  { id: "leftover", label: "余货未发", group: "进度" },
  { id: "shipped", label: "已发完", group: "进度" },
  { id: "spec", label: "卡资料", group: "阻塞" },
  { id: "fabric", label: "卡面料", group: "阻塞" },
  { id: "color", label: "卡色卡", group: "阻塞" },
  { id: "scrap", label: "有报废", group: "查阅" },
  { id: "rework", label: "有返工", group: "查阅" },
  { id: "packable", label: "待装箱", group: "查阅" },
] as const;

export const BOARD_VIEW_GROUPS = ["进度", "阻塞", "查阅"] as const;

export type BoardView = (typeof BOARD_VIEWS)[number]["id"];

export function parseBoardView(value: string | undefined): BoardView {
  return BOARD_VIEWS.some((item) => item.id === value) ? (value as BoardView) : "all";
}

export function filterProductionRows(rows: ProductionBoardRow[], view: string) {
  if (view === "not_started") return rows.filter((row) => row.stage === "not_started");
  if (view === "in_progress") return rows.filter((row) => row.stage === "in_progress");
  if (view === "leftover") return rows.filter((row) => row.leftover > 0);
  if (view === "shipped") return rows.filter((row) => row.stage === "shipped");
  if (view === "spec") return rows.filter((row) => row.watch.spec.length > 0);
  if (view === "fabric") return rows.filter((row) => row.watch.fabric.length > 0);
  if (view === "color") return rows.filter((row) => row.watch.colorCard.length > 0);
  if (view === "scrap") return rows.filter((row) => row.scrapped > 0);
  if (view === "rework") return rows.filter((row) => row.rework > 0);
  if (view === "packable") return rows.filter((row) => row.packable > 0);
  return rows;
}

function progressLabel(input: {
  leftover: number;
  packable: number;
  occupied: number;
  started: number;
  good: number;
  shipped: number;
  wip: number;
  scrapped: number;
  rework: number;
  blockerCount: number;
}) {
  const extras = [
    input.occupied ? `占用 ${input.occupied}` : "",
    input.scrapped ? `报废 ${input.scrapped}` : "",
    input.rework ? `返工 ${input.rework}` : "",
    input.blockerCount ? `阻塞 ${input.blockerCount}` : "",
  ]
    .filter(Boolean)
    .map((part) => ` · ${part}`)
    .join("");
  if (input.leftover > 0) return `余货 ${input.leftover} · 可发 ${input.packable}${extras}`;
  if (input.shipped > 0 && input.leftover === 0) return `已发完 ${input.shipped}${extras}`;
  if (input.started === 0) return `未投产${extras}`;
  return `在制 ${input.wip} · 合格 ${input.good}${extras}`;
}

export type ProductionBoardRow = {
  orderId: string;
  orderNo: string;
  factoryId: string | null;
  factoryName: string;
  styleCodes: string;
  started: number;
  scrapped: number;
  wip: number;
  good: number;
  shipped: number;
  leftover: number;
  rework: number;
  occupied: number;
  packable: number;
  stage: "not_started" | "in_progress" | "leftover_unshipped" | "shipped";
  readiness: string;
  exceptions: string[];
  watch: OrderWatch;
  cut: { status: OrderMaterialSupply["status"]; label: string; canCut: boolean };
  facts: string[];
  canRecord: boolean;
  canPackDraft: boolean;
  canOccupy: boolean;
  canShip: boolean;
  canWeigh: boolean;
  canRecon: boolean;
  owners: { factoryName: string; roles: string[] };
  progress: { leftover: number; packable: number; occupied: number; blockerCount: number; label: string };
  customerName: string;
  colorSize: ProductionColorSize;
  packing: ProductionPacking;
  recon: {
    id: string;
    status: string;
    shippedQty: number;
    unitPriceYuan: string | null;
    amountYuan: string | null;
    basisNote: string;
    paid: boolean;
  } | null;
};

export type ProductionBoard = {
  packingEnabled: boolean;
  facts: string[];
  rows: ProductionBoardRow[];
};

export async function getProductionBoard(
  organizationId: string,
  actor: { role: string; factoryId: string | null; userId?: string },
): Promise<ProductionBoard> {
  const canFinance = await canUserAction({ organizationId, userId: actor.userId ?? "", role: actor.role, factoryId: actor.factoryId }, "generate_factory_recon");
  const orders = await prisma.salesOrder.findMany({
    where: { organizationId, archivedAt: null, ...(actor.role === "factory" ? { factoryId: actor.factoryId ?? "__unassigned_factory__" } : {}) },
    include: {
      factory: true,
      customer: true,
      production: { include: { lines: true } },
      packingPlans: { include: { cartons: { include: { lines: true }, orderBy: { cartonNo: "asc" } } } },
      reconDrafts: { where: canFinance ? {} : { id: { in: [] } } },
      lines: { include: { style: true, colors: { include: { sizes: true } } } },
      tasks: { where: { status: "open", blocking: true } },
    },
    orderBy: { orderNo: "asc" },
  });
  const visible = orders.filter((order) => canSeeFactory(actor.role, actor.factoryId, order.factoryId));
  const summaries = visible.map((order) => ({ order, summary: summarizeProduction(order.production) }));
  const supplyByOrder = await getOrdersMaterialSupply(
    organizationId,
    summaries.map(({ order, summary }) => ({
      id: order.id,
      factoryId: order.factoryId,
      started: summary.started > 0,
    })),
  );
  const rows = summaries.map(({ order, summary }) => {
    const packingPlans: ProductionPackingPlan[] = order.packingPlans.map((plan) => ({
      id: plan.id,
      status: plan.status,
      total: plan.totalQty,
      cartons: plan.cartons.map((carton) => ({
        id: carton.id,
        cartonNo: carton.cartonNo,
        qty: carton.lines.reduce((sum, line) => sum + line.quantity, 0),
        colors: [...new Set(carton.lines.map((line) => line.colorName))],
        sizeCodes: [...new Set(carton.lines.map((line) => line.sizeCode))],
        weightStatus: carton.weightStatus,
        netWeight: carton.netWeight,
        grossWeight: carton.grossWeight,
        lines: carton.lines.map((line) => ({
          colorName: line.colorName,
          sizeCode: line.sizeCode,
          quantity: line.quantity,
        })),
      })),
    }));
    const occupied = packingPlans.filter((plan) => plan.status === "occupied").reduce((sum, plan) => sum + plan.total, 0);
    const packingShipped = packingPlans
      .filter((plan) => plan.status === "shipped")
      .reduce((sum, plan) => sum + plan.total, 0);
    const packable = availableFinishedGoods({
      good: summary.good,
      shipped: summary.shipped,
      occupied,
    });
    const exceptions = order.tasks.map((task) => labels.taskKind(task.kind));
    const facts: string[] = [];
    const transferredIn = order.production.filter(p => p.kind === "transfer_in").reduce((n, p) => n + p.quantity, 0);
    const transferredOut = order.production.filter(p => p.kind === "transfer_out").reduce((n, p) => n + p.quantity, 0);
    if (transferredIn || transferredOut) facts.push(`当前承接已开工数包含在制接收 ${transferredIn} 件，扣除转出 ${transferredOut} 件；原厂投产历史保留，不重复登记投产。`);
    if (summary.started > 0 || summary.good > 0) {
      facts.push(
        `余货 ${summary.leftover} 件 = 合格 ${summary.good} − 已发运 ${summary.shipped}。不能把投产减已发运记成报废。`,
      );
    }
    if (occupied > 0) {
      facts.push(`已装箱占用 ${occupied} 件，尚未出运，可发 ${packable} 件。`);
    }
    if (summary.incorrectScrapInference !== summary.scrapped && summary.started > 0) {
      facts.push(`投产减已发运是 ${summary.incorrectScrapInference}，不是报废。报废只记已登记的 ${summary.scrapped} 件。`);
    }
    const factoryOk = canSeeFactory(actor.role, actor.factoryId, order.factoryId);
    const factoryName = order.factory?.name ?? "未指定工厂";
    const supply = supplyByOrder.get(order.id);
    const watch = classifyOrderWatch(order.tasks, order.productionReadiness);
    if (supply && !summary.started) {
      watch.fabric = [...new Set([...watch.fabric, ...supply.blockers, ...supply.leftover.blockers])];
    }
    const roles = [
      ...new Set(
        order.tasks
          .map((task) => task.assigneeRole)
          .filter((role): role is string => Boolean(role))
          .map((role) => labels.role(role)),
      ),
    ];
    if (roles.length === 0 && order.tasks.length) roles.push(labels.role("salesperson"));
    const blockerCount = watch.spec.length + watch.fabric.length + watch.colorCard.length;
    return {
      orderId: order.id,
      orderNo: order.orderNo,
      factoryId: order.factoryId,
      factoryName,
      customerName: order.customer.name,
      owners: { factoryName, roles },
      progress: {
        leftover: summary.leftover,
        packable,
        occupied,
        blockerCount,
        label: progressLabel({
          leftover: summary.leftover,
          packable,
          occupied,
          started: summary.started,
          good: summary.good,
          shipped: summary.shipped,
          wip: summary.wip,
          scrapped: summary.scrapped,
          rework: summary.rework,
          blockerCount,
        }),
      },
      styleCodes: order.lines.map((line) => line.style.code).join("、") || "—",
      started: summary.started,
      scrapped: summary.scrapped,
      rework: summary.rework,
      wip: summary.wip,
      good: summary.good,
      shipped: summary.shipped,
      leftover: summary.leftover,
      occupied,
      packable,
      stage: summary.stage,
      readiness: order.productionReadiness,
      exceptions,
      watch,
      cut: {
        status: supply?.status ?? "unknown",
        label: supply?.label ?? "料况未知",
        canCut: supply?.canCut ?? false,
      },
      facts,
      colorSize: buildColorSize(order.lines, order.production),
      packing: {
        shippedTotal: packingShipped,
        occupiedTotal: occupied,
        plans: packingPlans,
      },
      canRecord:
        canApproveAction(actor.role, ACTION_TYPES.recordProductionQty) &&
        factoryOk &&
        !order.productionReadiness.startsWith("blocked") &&
        (summary.stage !== "not_started" || order.productionReadiness === "ready_for_production"),
      canPackDraft: canApproveAction(actor.role, ACTION_TYPES.createPackingDraft) && factoryOk && packable > 0,
      canOccupy: canApproveAction(actor.role, ACTION_TYPES.occupyPacking) && factoryOk,
      canShip: canApproveAction(actor.role, ACTION_TYPES.shipPacking) && factoryOk,
      canWeigh: canApproveAction(actor.role, ACTION_TYPES.recordCartonWeight) && factoryOk,
      canRecon: canFinance && factoryOk && summary.shipped > 0 && summary.shipped <= summary.good,
      recon: order.reconDrafts[0]
        ? {
            id: order.reconDrafts[0].id,
            status: order.reconDrafts[0].status,
            shippedQty: order.reconDrafts[0].shippedQty,
            unitPriceYuan: order.reconDrafts[0].unitPriceYuan,
            amountYuan: order.reconDrafts[0].amountYuan,
            basisNote: order.reconDrafts[0].basisNote,
            paid: order.reconDrafts[0].paid,
          }
        : null,
    } satisfies ProductionBoardRow;
  });
  rows.sort((a, b) => (STAGE_ORDER[a.stage] ?? 9) - (STAGE_ORDER[b.stage] ?? 9) || a.orderNo.localeCompare(b.orderNo));
  return {
    packingEnabled: true,
    facts: [
      "余货只等于合格减已发运，返工不增加合格。",
      "色尺弹窗是颜色×尺码嵌套表：订单/投产/合格/发运/余货。不是开裁/车间/后整。",
      "查阅按进度、阻塞、报废/返工/待装箱筛，不是开裁/车间/后整文件夹。负责人是工厂和任务角色。进度不是完成率。",
      "资料/色卡来自未关闭阻塞任务。面料列看能不能开裁：未到料、未调到厂、厂里不够，不是开裁打卡。",
      "投产门槛是资料批准、分色确认、厂里有可用料。门槛齐后经理批准，不会自动投产。正式采购未下达。",
      "装箱草稿、已装箱占用和正式发运分开；未确认不算实发。未称重是待称重，实测必须录入净重和毛重。",
      "对账草稿不是付款。未配置计价基准则待核实。发运不会自动付款。",
    ],
    rows,
  };
}

function mapQtyLines(lines: Array<{ colorName: string; sizeCode: string; quantity: number }>): ProductionColorSizeLine[] {
  return lines.map((line) => ({
    colorName: line.colorName,
    sizeCode: line.sizeCode,
    quantity: line.quantity,
  }));
}

export async function recordProductionQty(input: {
  organizationId: string;
  userId: string;
  role: string;
  factoryId: string | null;
  orderId: string;
  kind: string;
  quantity?: number;
  idempotencyKey: string;
  note?: string;
  lines?: Array<{ colorName: string; sizeCode?: string; quantity: number }>;
}) {
  if (input.kind === "shipped") throw new ExecutionError("发运必须通过已确认的装箱方案登记");
  if (!KINDS.has(input.kind as ProductionKind)) {
    throw new ExecutionError("产量类型无效");
  }
  let collected;
  try {
    collected = collectProductionLines(input.lines);
  } catch (error) {
    throw new ExecutionError(error instanceof Error ? error.message : "色尺件数必须是正整数");
  }
  const quantity = collected?.quantity ?? input.quantity;
  if (!Number.isSafeInteger(quantity) || !quantity || quantity <= 0 || quantity > 2_147_483_647) {
    throw new ExecutionError("数量必须是正整数");
  }
  if (collected && input.quantity != null && input.quantity !== collected.quantity) {
    throw new ExecutionError("色尺合计必须等于件数");
  }
  const idempotencyKey = input.idempotencyKey.trim();
  if (!idempotencyKey) throw new ExecutionError("幂等键不能为空");

  const order = await prisma.salesOrder.findFirst({
    where: { id: input.orderId, organizationId: input.organizationId },
    include: { lines: { include: { colors: { include: { sizes: true } } } } },
  });
  if (!order) throw new ExecutionError("订单不存在");
  if (!canApproveAction(input.role, ACTION_TYPES.recordProductionQty)) {
    throw new ExecutionError("无权登记产量");
  }
  if (!canSeeFactory(input.role, input.factoryId, order.factoryId)) {
    throw new ExecutionError("无权登记产量");
  }
  if (collected) {
    try {
      assertLinesMatchOrder(
        collected.lines,
        { colors: order.lines.flatMap((line) => line.colors) },
      );
    } catch (error) {
      throw new ExecutionError(error instanceof Error ? error.message : "色尺与本单不符");
    }
  }

  const existing = await prisma.productionQty.findUnique({
    where: { orderId_idempotencyKey: { orderId: order.id, idempotencyKey } },
    include: { lines: true },
  });
  if (existing) {
    assertSameProduction(existing, input.kind, quantity, collected?.lines ?? []);
    return { reused: true, record: existing, lines: mapQtyLines(existing.lines) };
  }

  try {
    return await prisma.$transaction(async (tx) => {
      const actualActor = await tx.user.findFirst({ where: { id: input.userId, organizationId: input.organizationId, role: input.role, active: true } });
      if (!actualActor || (actualActor.role === "factory" && actualActor.factoryId !== input.factoryId)) throw new ExecutionError("无权登记产量");
      const current = await lockOrderForWrite(tx, input.organizationId, order.id);
      if (!canSeeFactory(input.role, input.factoryId, current.factoryId)) throw new ExecutionError("无权登记产量");
      const repeated = await tx.productionQty.findUnique({
        where: { orderId_idempotencyKey: { orderId: order.id, idempotencyKey } }, include: { lines: true },
      });
      if (repeated) {
        assertSameProduction(repeated, input.kind, quantity, collected?.lines ?? []);
        return { reused: true, record: repeated, lines: mapQtyLines(repeated.lines) };
      }
      const totals = await tx.productionQty.groupBy({ by: ["kind"], where: { orderId: order.id }, _sum: { quantity: true } });
      const summary = summarizeProduction(totals.map(row => ({ kind: row.kind, quantity: row._sum.quantity ?? 0 })));
      if (current.productionReadiness.startsWith("blocked") || (summary.started === 0 && current.productionReadiness !== "ready_for_production")) {
        throw new ExecutionError("订单仍有投产阻塞，不能登记新的产量");
      }
      const handover = await tx.factoryTransfer.findFirst({ where: { organizationId: input.organizationId, newOrderId: order.id, status: "executed", receivedAt: null } });
      const incoming = await tx.factoryTransfer.findFirst({ where: { organizationId: input.organizationId, newOrderId: order.id, status: "executed" } });
      if (incoming && (JSON.parse(incoming.selectionJson)[0]?.stage ?? "unstarted") !== "unstarted" && !JSON.parse(incoming.afterJson).receipt?.continuationReady) throw new ExecutionError("接续工序、质量与后续用料尚未核对，不能登记产量");
      if (handover) throw new ExecutionError("新工厂尚未确认接收转厂任务，不能登记产量");
      const quantityReassigned = await tx.factoryTransfer.count({ where: { organizationId: input.organizationId, status: "executed", OR: [{ orderId: order.id }, { newOrderId: order.id }] } });
      const quantityAmended = await tx.followChange.count({ where: { organizationId: input.organizationId, status: "executed", impactJson: { contains: `"orderId":"${order.id}"` } } });
      if (input.kind === "started" && (quantityReassigned || quantityAmended)) {
        const planned = await tx.orderLine.findMany({ where: { orderId: order.id }, include: { colors: { include: { sizes: true } } } });
        if (summary.started + quantity > planned.reduce((n, l) => n + l.totalQuantity, 0)) throw new ExecutionError("投产数量超过本厂当前承接数量，请核对转厂记录");
        if (collected) {
          const past = await tx.productionQty.findMany({ where: { orderId: order.id, kind: { in: ["started", "transfer_in", "transfer_out"] } }, include: { lines: true } });
          const requested = new Map<string, number>();
          for (const row of collected.lines) { const key = JSON.stringify([row.colorName, row.sizeCode]); requested.set(key, (requested.get(key) ?? 0) + row.quantity); }
          for (const [key, qty] of requested) {
            const [color, size] = JSON.parse(key) as string[];
            const allowed = planned.flatMap(l => l.colors).filter(c => c.colorName === color).reduce((n, c) => n + (size ? c.sizes.filter(s => s.sizeCode === size).reduce((v, s) => v + s.quantity, 0) : c.quantity), 0);
            const started = past.reduce((n, p) => n + (p.kind === "transfer_out" ? -1 : 1) * p.lines.filter(l => l.colorName === color && l.sizeCode === size).reduce((v, l) => v + l.quantity, 0), 0);
            if (started + qty > allowed) throw new ExecutionError("该颜色尺码的投产数量超过本厂当前承接数量，请核对转厂记录");
          }
        }
      }
      if (["good", "scrapped"].includes(input.kind)) {
        const ledger = await tx.productionQty.findMany({ where: { orderId: order.id }, include: { lines: true } });
        if (ledger.some(p => p.kind === "transfer_in" || p.kind === "transfer_out")) {
          if (!collected) throw new ExecutionError("有在制转厂的订单必须按颜色尺码登记，避免串数");
          const requested = new Map<string, number>();
          for (const row of collected.lines) { const key = JSON.stringify([row.colorName, row.sizeCode]); requested.set(key, (requested.get(key) ?? 0) + row.quantity); }
          for (const [key, qty] of requested) {
            const [color, size] = JSON.parse(key) as string[];
            const scoped = ledger.map(p => ({ kind: p.kind, quantity: p.lines.filter(l => l.colorName === color && l.sizeCode === size).reduce((n, l) => n + l.quantity, 0) }));
            const row = summarizeProduction(scoped);
            if (row.good + row.scrapped + qty > row.started) throw new ExecutionError("该颜色尺码合格与报废超过当前承接的已开工数量");
          }
        }
      }
      const good = summary.good + (input.kind === "good" ? quantity : 0);
      const scrap = summary.scrapped + (input.kind === "scrapped" ? quantity : 0);
      if (good + scrap > summary.started && input.kind !== "started") throw new ExecutionError("合格与报废数量不能超过已登记投产");
      if (input.kind === "wip" && summary.wip + quantity > summary.started) throw new ExecutionError("在制数量不能超过已登记投产");
      if (collected) {
        const lines = await tx.orderLine.findMany({ where: { orderId: order.id }, include: { colors: { include: { sizes: true } } } });
        assertLinesMatchOrder(collected.lines, { colors: lines.flatMap(line => line.colors) });
      }
      const record = await tx.productionQty.create({
        data: {
          id: createId(),
          orderId: order.id,
          kind: input.kind,
          quantity,
          idempotencyKey,
          note: input.note?.trim() || labels.productionKind(input.kind),
          lines: collected
            ? {
                create: collected.lines.map((line) => ({
                  id: createId(),
                  colorName: line.colorName,
                  sizeCode: line.sizeCode,
                  quantity: line.quantity,
                })),
              }
            : undefined,
        },
        include: { lines: true },
      });
      await writeAudit({
        organizationId: input.organizationId,
        actorUserId: input.userId,
        action: "production.qty.recorded",
        entityType: "ProductionQty",
        entityId: record.id,
        summary: `${order.orderNo} 登记${labels.productionKind(input.kind)} ${quantity} 件`,
        payloadJson: JSON.stringify({
          actionType: ACTION_TYPES.recordProductionQty,
          kind: input.kind,
          quantity,
          idempotencyKey,
          lines: collected?.lines ?? [],
        }),
      }, tx);
      return { reused: false, record, lines: mapQtyLines(record.lines) };
    });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "P2002") {
      const record = await prisma.productionQty.findUnique({
        where: { orderId_idempotencyKey: { orderId: order.id, idempotencyKey } },
        include: { lines: true },
      });
      if (record) {
        assertSameProduction(record, input.kind, quantity, collected?.lines ?? []);
        return { reused: true, record, lines: mapQtyLines(record.lines) };
      }
    }
    throw error;
  }
}

function assertSameProduction(
  record: { kind: string; quantity: number; lines: ProductionColorSizeLine[] },
  kind: string,
  quantity: number,
  lines: ProductionColorSizeLine[],
) {
  const canonical = (items: ProductionColorSizeLine[]) => JSON.stringify(items.map(line => [line.colorName, line.sizeCode, line.quantity]).sort());
  if (record.kind !== kind || record.quantity !== quantity || canonical(record.lines) !== canonical(lines)) {
    throw new ExecutionError("幂等键对应的产量内容不一致，请核对原记录");
  }
}
