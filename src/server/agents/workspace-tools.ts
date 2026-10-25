import { z } from "zod";
import { prisma } from "@/lib/db";
import type { TradeActor } from "@/server/services/trade-contract";
import { getProductionGate } from "@/server/services/production-gate";
import type { AgentTool } from "./runtime";
import type { EvidenceCard } from "./business-tools";
import type { AgentTable } from "@/lib/agent-table";
import { currentWeekRange } from "@/lib/agent-delivery-range";
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(s => { const d = new Date(s); return !isNaN(d.getTime()) && d.toISOString().slice(0,10) === s; });
export function workspaceTools(actor: TradeActor, authorize: () => Promise<void>, originalText = "") {
  const cards: EvidenceCard[] = [], allowed = new Set<string>(); let read = false;
  const tables: AgentTable[] = [];
  let currentTable: AgentTable | null = null;
  let listedIds: string[] = [];
  const checked = new Map<string, boolean>();
  let unconfirmed = 0, limited = false;
  function updateConclusion() {
    if (!currentTable) return;
    const pending = listedIds.length - checked.size;
    const attention = [...checked.values()].filter(Boolean).length;
    currentTable.conclusion = {
      tone: attention ? "attention" : !listedIds.length || pending || unconfirmed || limited ? "incomplete" : "neutral",
      title: attention ? `已发现 ${attention} 张订单有待处理事项` : !listedIds.length ? "暂时无法判断交期风险" : pending ? `还有 ${pending} 张订单未完成风险核对` : unconfirmed || limited ? "已核对部分订单，仍有待核对项" : "已核对记录中暂未发现阻塞",
      detail: `所选交期范围内${limited ? "超过 20" : `有 ${listedIds.length}`} 张在办订单，已核对 ${checked.size} 张。${pending ? `还有 ${pending} 张尚未核对。` : ""}${unconfirmed ? `另有 ${unconfirmed} 张在办订单未确认交期，无法判断是否属于这个范围。` : ""}${!listedIds.length ? "查不到订单不等于没有风险。" : "这不是按期交付保证。"}`,
      nextStep: attention ? `先点订单号处理表中的缺项和阻塞待办。${unconfirmed ? "未确认交期的订单另行补齐。" : ""}${limited ? "缩小日期范围，继续核对其余订单。" : ""}` : pending ? "本次核对尚未完成，请重新查询或点订单号查看原记录。" : unconfirmed ? "先处理下方“交期待补齐”的订单：点订单号，进入“本单资料 → 补资料”核对交期，再查询风险。" : limited ? "缩小日期范围，继续核对其余订单。" : !listedIds.length ? "核对查询日期是否符合你的要求；也可以查询其他日期范围。" : "继续跟踪实际产量和出运；交期或资料变化后重新核对。",
    };
  }
  const tools: AgentTool[] = [{ name: "list_due_orders", description: "按交期查本公司订单（最多20单）", parameters: { type: "object", properties: { from: { type: "string", description: "开始日期 YYYY-MM-DD" }, to: { type: "string", description: "结束日期 YYYY-MM-DD，跨度最多31天" } }, required: ["from", "to"], additionalProperties: false }, run: async raw => {
    await authorize(); const proposed = z.object({ from: date, to: date }).strict().parse(raw);
    const week = currentWeekRange(originalText);
    const { from, to } = week ?? proposed;
    const days = (Date.parse(to)-Date.parse(from))/86400000; if (days < 0 || days >31) throw new Error("请查询31天以内的交期范围");
    const orders = await prisma.salesOrder.findMany({ where: { organizationId: actor.organizationId, status: { notIn: ["draft", "completed", "cancelled"] }, requestedDeliveryDate: { gte: from, lt: new Date(Date.parse(to)+86400000).toISOString().slice(0,10) } }, select: { id: true, orderNo: true, requestedDeliveryDate: true }, orderBy: [{ requestedDeliveryDate: "asc" }, { id: "asc" }], take: 21 });
    allowed.clear(); for(const o of orders.slice(0,20)) allowed.add(o.id);
    const undatedWhere = { organizationId: actor.organizationId, status: { notIn: ["draft", "completed", "cancelled"] }, requestedDeliveryDate: null };
    const [undatedCount, undated] = await Promise.all([
      prisma.salesOrder.count({ where: undatedWhere }),
      prisma.salesOrder.findMany({ where: undatedWhere, select: { id: true, orderNo: true, requestedDeliveryText: true, customer: { select: { name: true } }, factory: { select: { name: true } } }, orderBy: [{ orderNo: "asc" }, { id: "asc" }], take: 20 }),
    ]);
    unconfirmed = undatedCount; limited = orders.length > 20; checked.clear(); read = false;
    listedIds = orders.slice(0, 20).map(o => o.id);
    currentTable = { title: `${from} 至 ${to} · 交期与执行核对`, columns: ["订单", "交期", "工厂", "资料 / 分色 / 料况", "登记合格 / 出运（件）", "阻塞待办 / 负责角色", "经理放行"], rows: orders.slice(0, 20).map(o => ({ href: `/orders/${o.id}`, cells: [o.orderNo, o.requestedDeliveryDate, "尚未核对", "尚未核对", "尚未核对", "尚未核对", "尚未核对"] })), emptyMessage: "当前日期范围内没有符合条件的订单；不代表未确认交期的订单没有风险。" };
    currentTable.notes = [`查询口径：${week ? "本周按上海时间周一至周日；" : ""}只查当前账号可见的在办生产订单，草稿、已完成和已取消订单不在本次范围内。`, "未核对的单据不能认定没有风险；登记数量不能替代实际交付核验。投产仍按原流程由经理放行。", ...(limited ? ["本次最多核对 20 单，请缩小范围继续查。"] : [])];
    updateConclusion();
    tables.push(currentTable);
    if (unconfirmed) tables.push({ title: `交期待补齐 · ${unconfirmed} 张在办订单`, columns: ["订单（点击处理）", "客户", "工厂", "交期原话", "下一步"], rows: undated.map(o => ({ href: `/orders/${o.id}#prep`, cells: [o.orderNo, o.customer.name, o.factory?.name || "未指定", o.requestedDeliveryText || "尚未填写", "到本单资料 → 补资料核对交期，再查是否属于所选日期范围"] })), notes: ["这些订单尚不能归入所选日期范围，未认定为本周订单或已经延期。", ...(unconfirmed > undated.length ? ["仅列前 20 单，其余请到订单执行继续核对交期。"] : [])], emptyMessage: "没有待补交期的订单。" });
    cards.push({ title: `${from} 至 ${to} 交期核对`, facts: [`${unconfirmed} 张未确认交期订单不在日期筛选中，需另外补齐。`, orders.length >20 ? "仅列最近交期20单，请缩小范围继续查" : `查到${orders.length}张订单`, "风险依据是资料、分色、料况和阻塞记录，不是对能否按期交付的保证。"] });
    if (!orders.length) read = true;
    return { range: { from, to }, orders: orders.slice(0,20), limited, unconfirmedDeliveryOrders: unconfirmed, unconfirmedOrders: undated, conclusion: currentTable.conclusion };
  } }, { name: "read_order_risks", description: "联合核对资料、分色、厂内料况、产量和负责角色", parameters: { type: "object", properties: { orderIds: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 20 } }, required: ["orderIds"], additionalProperties: false }, run: async raw => {
    await authorize(); const { orderIds } = z.object({ orderIds: z.array(z.string()).min(1).max(20) }).strict().parse(raw);
    if (new Set(orderIds).size !== orderIds.length || orderIds.some(id => !allowed.has(id))) throw new Error("先按交期查询，再核对查询范围内的订单");
    const result = [];
    for (const id of orderIds) {
      await authorize();
      const order = await prisma.salesOrder.findFirstOrThrow({ where: { id, organizationId: actor.organizationId }, include: { factory: { select: { name: true } }, production: { select: { kind: true, quantity: true, createdAt: true } }, tasks: { where: { status: "open", blocking: true }, select: { id: true, title: true, assigneeRole: true }, take: 11 } } });
      const gate = await getProductionGate(actor.organizationId, id);
      const production = Object.fromEntries(["started", "good", "scrapped", "rework", "shipped"].map(kind => [kind, order.production.filter(p => p.kind === kind).reduce((n,p) => n+p.quantity,0)]));
      const checks = gate.checks.map(c => `${c.label}：${c.evidence}`);
      const tasks = order.tasks.slice(0, 10).map(t => `${t.title}（${t.assigneeRole === "manager" ? "经理" : t.assigneeRole === "factory" ? "工厂" : t.assigneeRole === "salesperson" ? "跟单员" : "待指定"}）`);
      if (order.tasks.length > 10) tasks.push("仅列前 10 项，打开订单查看其余待办");
      const rowIndex = listedIds.indexOf(id);
      if (currentTable && rowIndex >= 0) currentTable.rows[rowIndex] = { href: `/orders/${id}`, cells: [order.orderNo, order.requestedDeliveryDate, order.factory?.name || "未指定", checks.join("\n"), `${production.good} / ${production.shipped}`, tasks.join("\n") || "没有登记中的阻塞待办", gate.alreadyDone ? "已出运，不能再放行" : gate.alreadyReleased ? "经理已放行" : "未放行，须经理确认"] };
      cards.push({ title: order.orderNo, href: `/orders/${order.id}`, facts: [`交期 ${order.requestedDeliveryDate}；工厂 ${order.factory?.name || "未指定"}`, ...checks, `登记投产 ${production.started}、合格 ${production.good}、出运 ${production.shipped} 件`, ...order.tasks.slice(0,10).map(t => `待办：${t.title}；负责角色：${t.assigneeRole === "manager" ? "经理" : t.assigneeRole === "factory" ? "工厂" : t.assigneeRole === "salesperson" ? "跟单员" : "待指定"}`), gate.alreadyReleased ? "经理已放行，仍需按实际生产记录核对进度" : "投产仍须经理手动放行"] });
      checked.set(id, order.tasks.length > 0 || (!gate.alreadyDone && (!gate.alreadyReleased || gate.checks.some(c => !c.passed) || !order.factoryId)));
      result.push({ orderId: id, orderNo: order.orderNo, deliveryDate: order.requestedDeliveryDate, updatedAt: order.updatedAt.toISOString(), checks, production, tasks: order.tasks.slice(0,10), alreadyReleased: gate.alreadyReleased });
    }
    read = checked.size === listedIds.length; updateConclusion();
    return { checkedAt: new Date().toISOString(), orders: result, conclusion: currentTable?.conclusion, scope: "未读取财务金额，无写入或通知工具" };
  } }];
  return { tools, cards, tables, getOrderResult: () => null, hasEvidence: () => read };
}
