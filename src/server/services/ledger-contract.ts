import { z } from "zod";
const id=z.string().trim().min(1).max(120),text=z.string().trim().min(1).max(2000),amount=z.string().trim().min(1).max(32),version=z.number().int().nonnegative(),base={idempotencyKey:id};
export const NEXT_FINANCE_PERMISSIONS=[
 {action:"ledger_export",label:"\u603b\u8d26\u62a5\u8868\u5bfc\u51fa",description:"\u5bfc\u51fa\u8bd5\u7b97\u8868\uff0c\u9700\u603b\u8d26\u67e5\u9605\u6743\u9650"},
 {action:"treasury_record",label:"退款与结汇登记",description:"登记已发生资金调整，需外贸查阅；不发起银行交易"},
 {action:"treasury_reverse",label:"资金登记更正",description:"作废误登记的退款或结汇，保留原记录，需外贸查阅"},
 {action:"ledger_view",label:"总账查阅",description:"查阅账套、凭证、科目明细和试算表"},
 {action:"ledger_config",label:"账套与科目配置",description:"配置演示账套和科目，需总账查阅"},
 {action:"ledger_prepare",label:"总账制单",description:"填制、修订或生成反向凭证草稿，需总账查阅"},
 {action:"ledger_review",label:"总账复核",description:"复核他人凭证，不能复核本人制单；需总账查阅"},
 {action:"ledger_post",label:"总账过账",description:"对已复核凭证执行不可改写的过账；需总账查阅"},
 {action:"ledger_close",label:"会计期间控制",description:"演示期间关闭/重开，保留核对依据；需总账查阅"},
] as const;
export type NextFinancePermission=typeof NEXT_FINANCE_PERMISSIONS[number]["action"];
export const JournalLineSchema=z.object({accountId:id,debit:amount,credit:amount,note:z.string().trim().max(500).default("")});
export const LedgerCommandSchema=z.discriminatedUnion("action",[
 z.object({...base,action:z.literal("create_book"),name:z.string().trim().min(1).max(100),baseCurrency:z.string().length(3),startMonth:z.string().regex(/^\d{4}-\d{2}$/)}),
 z.object({...base,action:z.literal("create_account"),bookId:id,code:z.string().regex(/^[A-Za-z0-9._-]{1,32}$/),name:z.string().trim().min(1).max(100),category:z.enum(["asset","liability","equity","income","expense"])}),
 z.object({...base,action:z.literal("set_account_active"),id,bookId:id,active:z.boolean(),reason:text}),
 z.object({...base,action:z.literal("add_period"),bookId:id,month:z.string().regex(/^\d{4}-\d{2}$/)}),
 z.object({...base,action:z.literal("save_journal"),id:z.string().max(120).optional(),bookId:id,date:id,summary:z.string().trim().min(1).max(200),basis:text,expectedVersion:version,lines:z.array(JournalLineSchema).min(2).max(50)}),
 z.object({...base,action:z.literal("from_source"),bookId:id,date:id,sourceType:z.enum(["cash","bill","adjustment","refund","fx"]),sourceId:id,debitAccountId:id,creditAccountId:id,feeAccountId:z.string().max(120).default(""),gainLossAccountId:z.string().max(120).default(""),rate:z.string().max(32).default(""),rateDate:id,carryingAmount:z.string().max(32).default(""),basis:text}),
 z.object({...base,action:z.literal("review_journal"),id,expectedVersion:version}),
 z.object({...base,action:z.literal("post_journal"),id,expectedVersion:version}),
 z.object({...base,action:z.literal("void_journal"),id,expectedVersion:version,reason:text}),
 z.object({...base,action:z.literal("reverse_journal"),id,expectedVersion:version,date:id,reason:text}),
 z.object({...base,action:z.literal("close_period"),bookId:id,month:id,reason:text}),
 z.object({...base,action:z.literal("reopen_period"),bookId:id,month:id,reason:text}),
]);
export type LedgerCommand=z.infer<typeof LedgerCommandSchema>;
export const TreasuryCommandSchema=z.discriminatedUnion("action",[
 z.object({...base,action:z.literal("record_refund"),sourceCashId:id,expectedVersion:version,amount,fee:amount,bankAccount:z.string().trim().min(1).max(100),bankReference:id,occurredOn:id,basis:text}),
 z.object({...base,action:z.literal("record_fx"),sourceCashId:id,expectedVersion:version,amount,toCurrency:z.string().length(3),rate:amount,fee:amount,toAccount:z.string().trim().min(1).max(100),bankReference:id,occurredOn:id,rateDate:id,basis:text}),
 z.object({...base,action:z.literal("void_refund"),id,reason:text}),
 z.object({...base,action:z.literal("void_fx"),id,reason:text}),
]);
export type TreasuryCommand=z.infer<typeof TreasuryCommandSchema>;
