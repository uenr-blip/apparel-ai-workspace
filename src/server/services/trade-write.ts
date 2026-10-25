import { writeStageExpense } from "./stage-expenses";
import { prisma } from "@/lib/db";
import { createId, sha256 } from "@/lib/hash";
import { TradeError } from "@/lib/trade-money";
import { deletePrivateFile } from "@/server/storage/local";
import { writeAudit } from "./intake";
import { requireTrade } from "./trade-db";
import { COMMAND_PERMISSION, TradeCommandSchema, type TradeActor } from "./trade-contract";
import { writeTradeBill } from "./trade-bills";
import { writeTradeSettlement } from "./trade-settlement";
import { storeTradeFile, writeTradeDocument, type TradeUpload, type StoredTradeFile } from "./trade-documents";

export async function runTradeCommand(actor: TradeActor, input: unknown, upload?: TradeUpload) {
  const parsed = TradeCommandSchema.safeParse(input);
  if (!parsed.success) throw new TradeError(`请检查输入：${parsed.error.issues[0]?.message ?? "格式不正确"}`);
  const command = parsed.data, permission = COMMAND_PERMISSION[command.action];
  await requireTrade(actor, permission);
  if (upload && !["add_document", "attach_document", "create_stage_expense"].includes(command.action)) throw new TradeError("此动作不接受附件");
  let file: StoredTradeFile | null = null;
  try {
    if (upload) file = await storeTradeFile(actor, upload);
    const requestHash = sha256(JSON.stringify({ command, file: file ? { hash: file.contentHash, name: file.filename, type: file.mimeType } : null }));
    const result = await prisma.$transaction(async db => {
      // The first write takes the SQLite write lock before reading any mutable balances.
      await db.$executeRaw`INSERT INTO TradeBook(organizationId,revision) VALUES(${actor.organizationId},1) ON CONFLICT(organizationId) DO UPDATE SET revision=revision+1`;
      await requireTrade(actor, permission, db);
      const [previous] = await db.$queryRaw<Array<{ requestHash: string; resultJson: string }>>`SELECT requestHash,resultJson FROM TradeOperation WHERE organizationId=${actor.organizationId} AND idempotencyKey=${command.idempotencyKey}`;
      if (previous) {
        if (previous.requestHash !== requestHash) throw new TradeError("同一凭证标识的内容不一致，请勿重复用于不同业务", 409);
        return { ...(JSON.parse(previous.resultJson) as { id: string; summary: string }), reused: true };
      }
      const now = new Date().toISOString();
      const result = command.action === "create_stage_expense" ? await writeStageExpense(db, actor, command, now) : ["add_document", "attach_document", "void_document"].includes(command.action) ? await writeTradeDocument(db, actor, command, now, file)
        : ["record_cash", "void_cash", "allocate", "reverse_allocation"].includes(command.action) ? await writeTradeSettlement(db, actor, command, now)
        : await writeTradeBill(db, actor, command, now);
      if (command.action === "create_stage_expense" && file) {
        await writeTradeDocument(db, actor, { action: "add_document", idempotencyKey: command.idempotencyKey, orderId: "", billId: result.id, cashId: "", packingPlanId: "", kind: "other", number: command.expenseReference, issuedOn: command.expenseDate, note: command.basis }, now, file);
      }
      await writeAudit({ organizationId: actor.organizationId, actorUserId: actor.userId, action: `trade.${command.action}`, entityType: "TradeLedger", entityId: result.id, summary: result.summary,
        payloadJson: JSON.stringify({ command, result, ...(command.action === "create_stage_expense" ? { before: null, after: { billId: result.id, projectId: command.projectId || null, followRowId: command.followRowId || null, currency: command.currency, amount: command.amount, status: "draft", expenseDate: command.expenseDate, basis: command.basis } } : {}), attachmentHash: file?.contentHash ?? null, bankPaymentInitiated: false, generalLedgerPosted: false }),
      }, db);
      await db.$executeRaw`INSERT INTO TradeOperation(id,organizationId,idempotencyKey,requestHash,resultJson,createdAt) VALUES(${createId()},${actor.organizationId},${command.idempotencyKey},${requestHash},${JSON.stringify(result)},${now})`;
      return { ...result, reused: false };
    }, { timeout: 15000, maxWait: 5000 });
    if (result.reused && file) await deletePrivateFile(file.storagePath);
    return result;
  } catch (error) {
    if (file) await deletePrivateFile(file.storagePath).catch(() => undefined);
    throw error;
  }
}
