import { createId, sha256Bytes } from "@/lib/hash";
import { TradeError, checkDate } from "@/lib/trade-money";
import { putPrivateFile } from "@/server/storage/local";
import { billRow, cashRow, tradeOrder, type TradeDb } from "./trade-db";
import { packingEvidence } from "./trade-bills";
import { DOC_KINDS, type TradeActor, type TradeCommand } from "./trade-contract";

export type TradeUpload = { filename: string; mimeType: string; bytes: Buffer };
export type StoredTradeFile = { filename: string; mimeType: string; storagePath: string; contentHash: string };
export async function storeTradeFile(actor: TradeActor, file: TradeUpload): Promise<StoredTradeFile> {
  if (!file.bytes.length || file.bytes.length > 8 * 1024 * 1024 || file.filename.length > 200) throw new TradeError("附件应为1字节至8MB，文件名不超过200字");
  const png = file.bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
  const jpeg = file.bytes[0] === 255 && file.bytes[1] === 216 && file.bytes[2] === 255;
  const pdf = file.bytes.subarray(0, 5).toString() === "%PDF-";
  const detected = png ? "image/png" : jpeg ? "image/jpeg" : pdf ? "application/pdf" : null;
  if (!detected || file.mimeType !== detected) throw new TradeError("仅支持内容匹配的PDF、PNG或JPG附件");
  const extension = png ? "png" : jpeg ? "jpg" : "pdf";
  const storagePath = `trade/${encodeURIComponent(actor.organizationId)}/${createId()}.${extension}`;
  await putPrivateFile(storagePath, file.bytes);
  return { filename: file.filename.replace(/[\r\n\u0000]/g, ""), mimeType: detected, storagePath, contentHash: sha256Bytes(file.bytes) };
}
export async function writeTradeDocument(db: TradeDb, actor: TradeActor, command: TradeCommand, now: string, file: StoredTradeFile | null) {
  const org = actor.organizationId;
  if (command.action === "attach_document") {
    if (!file) throw new TradeError("请选择要补充的原文件");
    const changed = await db.$executeRaw`UPDATE TradeDocument SET filename=${file.filename},mimeType=${file.mimeType},storagePath=${file.storagePath},contentHash=${file.contentHash} WHERE id=${command.id} AND organizationId=${org} AND status='active' AND storagePath IS NULL`;
    if (changed !== 1) throw new TradeError("单证不存在、已作废或已附原文件，不能覆盖");
    return { id: command.id, summary: "补充单证原文件，保留文件哈希和操作记录" };
  }
  if (command.action === "add_document") {
    const order = command.orderId ? await tradeOrder(db, actor, command.orderId) : null;
    const bill = command.billId ? await billRow(db, org, command.billId) : null;
    if (!order && (!bill || bill.orderId || (!bill.projectId && !bill.followRowId))) throw new TradeError("请选择真实订单，或在阶段费用中关联凭据");
    if (bill && (bill.orderId !== (order?.id ?? null) || bill.status === "void")) throw new TradeError("关联单据不属于本订单或已作废");
    if (command.cashId) {
      const cash = await cashRow(db, org, command.cashId);
      if (cash.status !== "recorded") throw new TradeError("不能关联已作废流水");
      if (bill && (cash.partyId !== bill.partyId || cash.partyKind !== bill.partyKind || cash.direction !== (bill.direction === "receivable" ? "receive" : "pay"))) throw new TradeError("关联流水与业务单据的往来方或方向不一致");
      if (cash.direction === "receive" && cash.partyId !== order?.customerId) throw new TradeError("收款流水客户与订单不一致");
      if (cash.direction === "pay" && order) {
        const matches = await db.$queryRaw<Array<{ id: string }>>`SELECT id FROM TradeBill WHERE organizationId=${org} AND orderId=${order.id} AND partyId=${cash.partyId} AND direction='payable' AND status<>'void' LIMIT 1`;
        if (!matches.length) throw new TradeError("该付款往来方未关联本单应付，请先登记相应业务单据");
      }
    }
    if (!order && command.packingPlanId) throw new TradeError("阶段费用不能关联出运批次");
    if (order) await packingEvidence(db, org, order.id, command.packingPlanId);
    const duplicate = await db.tradeDocument.findMany({ where: { organizationId: org, ...(order ? { orderId: order.id } : { orderId: null, billId: bill!.id }), kind: command.kind, number: command.number, status: "active" }, take: 1 });
    if (duplicate.length) throw new TradeError("本单已经登记相同类型和编号的单证，可在原记录补充原文件");
    const id = createId(), issuedOn = checkDate(command.issuedOn);
    await db.$executeRaw`INSERT INTO TradeDocument(id,organizationId,orderId,kind,number,issuedOn,note,billId,cashId,packingPlanId,filename,mimeType,storagePath,contentHash,status,createdBy,createdAt)
      VALUES(${id},${org},${order?.id ?? null},${command.kind},${command.number},${issuedOn},${command.note},${command.billId || null},${command.cashId || null},${command.packingPlanId || null},${file?.filename ?? null},${file?.mimeType ?? null},${file?.storagePath ?? null},${file?.contentHash ?? null},'active',${actor.userId},${now})`;
    return { id, summary: `${order?.orderNo ?? bill!.orderNo} 登记${DOC_KINDS[command.kind]} ${command.number}${file ? "，附原文件" : "，待补原文件"}` };
  }
  if (command.action === "void_document") {
    const count = await db.$executeRaw`UPDATE TradeDocument SET status='void',voidReason=${command.reason} WHERE id=${command.id} AND organizationId=${org} AND status='active'`;
    if (count !== 1) throw new TradeError("单证不存在或已经作废");
    return { id: command.id, summary: `作废单证登记：${command.reason}；原附件留存` };
  }
  throw new TradeError("不支持的单证动作");
}
