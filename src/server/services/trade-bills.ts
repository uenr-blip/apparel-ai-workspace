import { requireUnpostedSource } from "./ledger-db";
import { materialSource } from "./material-db";
import { createId, sha256 } from "@/lib/hash";
import { checkDate, MAX_MINOR, parseMoney, TradeError } from "@/lib/trade-money";
import { getFactoryReconPreview } from "./recon";
import { billRow, getContractRow, orderReceivableTotal, requireVersion, tradeOrder, tradeParty, type TradeDb } from "./trade-db";
import type { TradeActor, TradeCommand } from "./trade-contract";

export async function packingEvidence(db: TradeDb, org: string, orderId: string, packingPlanId: string) {
  if (!packingPlanId) return;
  const plan = await db.packingPlan.findFirst({ where: { id: packingPlanId, organizationId: org, orderId, status: "shipped" } });
  if (!plan) throw new TradeError("出运批次不存在、未实际出运或不属于本单");
}
export async function billSource(db: TradeDb, actor: TradeActor, orderId: string | null, kind: string, id: string) {
  if (!orderId) throw new TradeError("自动来源须关联真实生产订单");
  if (kind === "receipt") return materialSource(db, actor, orderId, id);
  if (kind === "recon") {
    const preview = await getFactoryReconPreview(actor.organizationId, orderId, db);
    if (!preview.draft || preview.draft.id !== id || preview.blockedReason || preview.needsUpdate || !preview.draft.amountYuan || preview.status !== "draft") throw new TradeError("加工草稿缺失或依据已变化，请先在工厂对账中重新核对");
    return { snapshot: preview.snapshot, amount: parseMoney(preview.draft.amountYuan, "CNY"), partyId: preview.factoryId, currency: "CNY" };
  }
  const purchase = await db.purchaseDraft.findFirst({ where: { id, organizationId: actor.organizationId, orderId } });
  if (!purchase || purchase.status !== "draft") throw new TradeError("采购草稿不存在或已过期，请先重新核对");
  return { snapshot: sha256(JSON.stringify(purchase)), amount: parseMoney(purchase.amountYuan, "CNY"), partyId: null, currency: "CNY" };
}

export async function writeTradeBill(db: TradeDb, actor: TradeActor, command: TradeCommand, now: string): Promise<{ id: string; summary: string }> {
  const org = actor.organizationId;
  if (command.action === "save_contract") {
    const order = await tradeOrder(db, actor, command.orderId);
    const existing = await getContractRow(db, org, order.id);
    requireVersion(existing?.version ?? 0, command.expectedVersion);
    const amount = parseMoney(command.amount, command.currency);
    const used = await orderReceivableTotal(db, org, order.id);
    if (used > amount) throw new TradeError("合同金额不能小于有效应收计划总额");
    if (existing && existing.currency !== command.currency) {
      const active = await db.$queryRaw<Array<{ id: string }>>`SELECT id FROM TradeBill WHERE organizationId=${org} AND orderId=${order.id} AND direction='receivable' AND status<>'void' LIMIT 1`;
      if (active.length) throw new TradeError("存在有效应收单据时不能直接更换合同币种");
    }
    const id = existing?.id ?? createId();
    if (existing) await db.$executeRaw`UPDATE TradeContract SET currency=${command.currency},amountMinor=${amount},tradeMode=${command.tradeMode},incoterm=${command.incoterm},terms=${command.terms},version=version+1,updatedAt=${now} WHERE id=${id} AND organizationId=${org}`;
    else await db.$executeRaw`INSERT INTO TradeContract(id,organizationId,orderId,currency,amountMinor,tradeMode,incoterm,terms,version,createdBy,createdAt,updatedAt) VALUES(${id},${org},${order.id},${command.currency},${amount},${command.tradeMode},${command.incoterm},${command.terms},1,${actor.userId},${now},${now})`;
    return { id, summary: `${order.orderNo} 保存外贸结算条件：${command.currency} ${command.amount}` };
  }
  if (command.action === "create_bill") {
    const order = await tradeOrder(db, actor, command.orderId);
    const amount = parseMoney(command.amount, command.currency), due = checkDate(command.dueDate);
    const receivable = command.direction === "receivable";
    const partyId = receivable ? order.customerId : command.partyId;
    const partyKind = receivable ? "customer" : "party";
    await tradeParty(db, org, partyKind, partyId);
    if (receivable) {
      const contract = await getContractRow(db, org, order.id);
      if (!contract) throw new TradeError("请先登记本单外贸结算条件");
      if (contract.currency !== command.currency) throw new TradeError("应收币种须与合同币种一致");
      if (await orderReceivableTotal(db, org, order.id) + amount > contract.amountMinor) throw new TradeError("应收计划总额超过合同金额");
      if (!["deposit", "balance", "shipment", "other"].includes(command.category)) throw new TradeError("应收款项类型不适用");
    }
    await packingEvidence(db, org, order.id, command.packingPlanId);
    let sourceSnapshot: string | null = null;
    if (command.sourceKind !== "manual") {
      if (receivable || !command.sourceId || (command.sourceKind !== "receipt" && command.currency !== "CNY")) throw new TradeError("采购或加工草稿只可作为人民币应付草稿来源");
      const source = await billSource(db, actor, order.id, command.sourceKind, command.sourceId);
      if (source.currency !== command.currency) throw new TradeError("\u5e01\u79cd\u4e0e\u6765\u6e90\u4e0d\u4e00\u81f4");
      if (command.sourceKind === "receipt" && command.category !== "materials") throw new TradeError("\u6536\u6599\u5e94\u4ed8\u987b\u5f52\u4e3a\u6750\u6599\u6b3e");
      if (command.sourceKind === "receipt" || command.sourceKind === "purchase") {
        const overlap = await db.$queryRaw<Array<{id:string}>>`SELECT b.id FROM TradeBill b JOIN MaterialReceipt r ON r.organizationId=b.organizationId WHERE b.organizationId=${org} AND b.status<>'void' AND ((r.id=${command.sourceId} AND b.sourceKind='purchase' AND b.sourceId=r.purchaseDraftId) OR (r.purchaseDraftId=${command.sourceId} AND b.sourceKind='receipt' AND b.sourceId=r.id)) LIMIT 1`;
        if (overlap.length) throw new TradeError("\u91c7\u8d2d\u8349\u7a3f\u4e0e\u6536\u6599\u5df2\u6709\u5173\u8054\u5e94\u4ed8\uff0c\u8bf7\u5148\u6838\u5bf9\u65e7\u5355\uff0c\u4e0d\u80fd\u91cd\u590d\u5efa\u7acb");
      }
      if (amount !== source.amount || (source.partyId && source.partyId !== partyId)) throw new TradeError("金额或结算工厂与来源草稿不一致");
      const duplicates = await db.$queryRaw<Array<{ id: string }>>`SELECT id FROM TradeBill WHERE organizationId=${org} AND sourceKind=${command.sourceKind} AND sourceId=${command.sourceId} AND status<>'void' LIMIT 1`;
      if (duplicates.length) throw new TradeError("该来源已有有效应付单，不能重复生成");
      sourceSnapshot = source.snapshot;
    } else if (command.sourceId) throw new TradeError("手工单据不能携带未核对的来源编号");
    const id = createId();
    await db.$executeRaw`INSERT INTO TradeBill(id,organizationId,orderId,direction,partyKind,partyId,title,category,currency,amountMinor,dueDate,basis,packingPlanId,sourceKind,sourceId,sourceSnapshot,status,version,createdBy,createdAt)
      VALUES(${id},${org},${order.id},${command.direction},${partyKind},${partyId},${command.title},${command.category},${command.currency},${amount},${due},${command.basis},${command.packingPlanId || null},${command.sourceKind},${command.sourceId || null},${sourceSnapshot},'draft',1,${actor.userId},${now})`;
    return { id, summary: `${order.orderNo} 登记${receivable ? "应收" : "应付"}草稿：${command.title} ${command.currency} ${command.amount}` };
  }
  if (!["confirm_bill", "void_bill", "adjust_bill"].includes(command.action) || !("id" in command) || !("expectedVersion" in command)) throw new TradeError("不支持的单据动作");
  const bill = await billRow(db, org, command.id);
  requireVersion(bill.version, command.expectedVersion);
  if (bill.status === "void") throw new TradeError("单据已作废，不能继续办理");
  if (command.action === "confirm_bill") {
    if (bill.status !== "draft") throw new TradeError("单据已经确认");
    if (bill.sourceKind !== "manual") {
      const current = await billSource(db, actor, bill.orderId, bill.sourceKind, bill.sourceId!);
      if (current.snapshot !== bill.sourceSnapshot) throw new TradeError("来源已变化，请作废旧草稿后按新依据重新登记", 409);
    }
    await db.$executeRaw`UPDATE TradeBill SET status='confirmed',confirmedAt=${now},version=version+1 WHERE id=${bill.id} AND organizationId=${org}`;
    return { id: bill.id, summary: `${bill.orderNo} 确认业务${bill.direction === "receivable" ? "应收" : "应付"}：${bill.title}，未过总账` };
  }
  if (command.action === "void_bill") {
    await requireUnpostedSource(db,org,"bill",bill.id);
    if (bill.allocatedMinor > BigInt(0)) throw new TradeError("请先撤回该单的核销，再作废单据");
    await db.$executeRaw`UPDATE TradeBill SET status='void',voidReason=${command.reason},version=version+1 WHERE id=${bill.id} AND organizationId=${org}`;
    return { id: bill.id, summary: `${bill.orderNo} 作废业务单据：${bill.title}；${command.reason}` };
  }
  if (command.action !== "adjust_bill") throw new TradeError("不支持的单据动作");
  if (bill.status !== "confirmed") throw new TradeError("扣补须在单据确认后登记；草稿有误可作废重建");
  if (bill.sourceKind === "receipt") throw new TradeError("\u6536\u6599\u5e94\u4ed8\u8bf7\u5148\u6838\u5bf9\u539f\u6536\u6599\u7684\u9000\u8865\u6216\u8ba1\u4ef7\u7248\u672c\uff0c\u518d\u529e\u7406\u5b9e\u7269\u5dee\u5f02\u6263\u8865");
  const amount = parseMoney(command.amount, bill.currency, { signed: true });
  const total = bill.totalMinor + amount;
  if (total < bill.allocatedMinor || total < BigInt(0) || total > MAX_MINOR) throw new TradeError("扣补后的金额不能低于已核销金额或超出金额范围");
  if (bill.direction === "receivable") {
    if (!bill.orderId) throw new TradeError("应收须关联订单结算条件");
    const contract = await getContractRow(db, org, bill.orderId);
    if (!contract || contract.currency !== bill.currency) throw new TradeError("本单合同币种与应收记录不一致，请先核对");
    if (await orderReceivableTotal(db, org, bill.orderId) + amount > contract.amountMinor) throw new TradeError("扣补后应收总额超过合同金额");
  }
  const id = createId();
  await db.$executeRaw`INSERT INTO TradeAdjustment(id,organizationId,billId,amountMinor,reason,createdBy,createdAt) VALUES(${id},${org},${bill.id},${amount},${command.reason},${actor.userId},${now})`;
  await db.$executeRaw`UPDATE TradeBill SET version=version+1 WHERE id=${bill.id} AND organizationId=${org}`;
  return { id: bill.id, summary: `${bill.orderNo} ${bill.title} 登记扣补 ${bill.currency} ${command.amount}：${command.reason}` };
}
