import { z } from "zod";
import { CURRENCIES } from "@/lib/trade-money";

const id = z.string().trim().min(1).max(120);
const text = z.string().trim().min(1).max(2000);
const optionalId = z.string().trim().max(120).optional().default("");
const amount = z.string().trim().min(1).max(32);
const currency = z.string().trim().toUpperCase().refine(value => Object.hasOwn(CURRENCIES, value), "不支持该币种");
const version = z.number().int().nonnegative();
const base = { idempotencyKey: id };
export const TRADE_MODES = { unknown: "出口模式待确认", self: "自营出口", agent: "代理出口", processing: "承接外贸加工", mixed: "混合业务" } as const;
export const DOC_KINDS = { contract: "合同 / 订单约定", commercial_invoice: "商业发票", packing_list: "装箱单", customs: "报关资料", bank_receipt: "银行回单", purchase_invoice: "采购发票", other: "其他单证" } as const;
export const BILL_CATEGORIES = { deposit: "订金", balance: "尾款", shipment: "分批出运", materials: "材料款", processing: "加工款", other: "其他" } as const;
export const EXPENSE_KINDS = { materials: "面辅料 / 纱线", sampling: "打样费", processing: "工艺加工", testing: "测试费", delivery: "寄样 / 运费", other: "其他费用" } as const;
export const TradeCommandSchema = z.discriminatedUnion("action", [
  z.object({ ...base, action: z.literal("save_contract"), orderId: id, currency, amount, tradeMode: z.enum(["unknown", "self", "agent", "processing", "mixed"]), incoterm: z.string().trim().max(80), terms: text, expectedVersion: version }),
  z.object({ ...base, action: z.literal("create_bill"), orderId: id, direction: z.enum(["receivable", "payable"]), partyId: optionalId, title: z.string().trim().min(1).max(120), category: z.enum(["deposit", "balance", "shipment", "materials", "processing", "other"]), currency, amount, dueDate: id, basis: text, packingPlanId: optionalId, sourceKind: z.enum(["manual", "recon", "purchase", "receipt"]).default("manual"), sourceId: optionalId }),
  z.object({ ...base, action: z.literal("create_stage_expense"), projectId: optionalId, followRowId: optionalId, expectedStamp: id, partyId: id, title: z.string().trim().min(1).max(120), expenseKind: z.enum(["materials", "sampling", "processing", "testing", "delivery", "other"]), currency, amount, dueDate: id, expenseDate: id, expenseReference: z.string().trim().min(1).max(120), basis: text }),
  z.object({ ...base, action: z.literal("confirm_bill"), id, expectedVersion: version }),
  z.object({ ...base, action: z.literal("void_bill"), id, expectedVersion: version, reason: text }),
  z.object({ ...base, action: z.literal("adjust_bill"), id, expectedVersion: version, amount, reason: text }),
  z.object({ ...base, action: z.literal("record_cash"), direction: z.enum(["receive", "pay"]), partyId: id, currency, amount, fee: amount, bankAccount: z.string().trim().min(1).max(100), bankReference: z.string().trim().min(1).max(120), occurredOn: id, basis: text, baseCurrency: z.string().max(3).default(""), exchangeRate: z.string().max(32).default(""), rateDate: z.string().max(10).default(""), rateSource: z.string().trim().max(500).default("") }),
  z.object({ ...base, action: z.literal("void_cash"), id, expectedVersion: version, reason: text }),
  z.object({ ...base, action: z.literal("allocate"), billId: id, cashId: id, cashAmount: amount, expectedBillVersion: version, expectedCashVersion: version, exchangeRate: z.string().max(32).default(""), rateDate: z.string().max(10).default(""), rateSource: z.string().trim().max(500).default("") }),
  z.object({ ...base, action: z.literal("reverse_allocation"), id, reason: text }),
  z.object({ ...base, action: z.literal("add_document"), orderId: optionalId, kind: z.enum(["contract", "commercial_invoice", "packing_list", "customs", "bank_receipt", "purchase_invoice", "other"]), number: z.string().trim().min(1).max(120), issuedOn: id, note: z.string().trim().max(2000), billId: optionalId, cashId: optionalId, packingPlanId: optionalId }),
  z.object({ ...base, action: z.literal("attach_document"), id }),
  z.object({ ...base, action: z.literal("void_document"), id, reason: text }),
]);
export type TradeCommand = z.infer<typeof TradeCommandSchema>;
export type TradeActor = { organizationId: string; userId: string; role: string; factoryId: string | null };
export const TRADE_PERMISSIONS = [
  { action: "trade_view", label: "外贸财务查阅", description: "查阅外贸应收应付、流水和单证，不含登记与核销" },
  { action: "trade_prepare", label: "外贸单据登记", description: "维护订单结算条件、应收应付草稿与单证；需同时有查阅权限" },
  { action: "trade_confirm", label: "应收应付确认与扣补", description: "确认业务台账、登记扣补或作废；不是总账过账，需查阅权限" },
  { action: "trade_cash", label: "收付流水登记", description: "登记已发生收付款及作废；不发起银行支付，需查阅权限" },
  { action: "trade_reconcile", label: "收付核销与撤回", description: "分配收付流水、核销单据或撤回核销，需查阅权限" },
  { action: "trade_export", label: "外贸台账导出", description: "导出当前筛选的业务数据，需查阅权限" },
] as const;
export type TradePermission = typeof TRADE_PERMISSIONS[number]["action"];
export const COMMAND_PERMISSION: Record<TradeCommand["action"], TradePermission> = {
  create_stage_expense: "trade_prepare", save_contract: "trade_prepare", create_bill: "trade_prepare", add_document: "trade_prepare", attach_document: "trade_prepare", void_document: "trade_prepare",
  confirm_bill: "trade_confirm", void_bill: "trade_confirm", adjust_bill: "trade_confirm",
  record_cash: "trade_cash", void_cash: "trade_cash", allocate: "trade_reconcile", reverse_allocation: "trade_reconcile",
};
