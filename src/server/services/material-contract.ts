import { z } from "zod";
const id=z.string().trim().min(1).max(120),basis=z.string().trim().min(1).max(2000),qty=z.string().trim().min(1).max(30),key={idempotencyKey:id};
export const MATERIAL_PERMISSIONS=[
  {action:"material_receive",label:"实际收料登记",description:"登记实际已验收放行的收料与批次，不下达采购"},
  {action:"material_correct",label:"实物退补与冲销",description:"办理退供、未耗用退回及受控冲销，保留正反凭证"},
] as const;
export const MaterialCommandSchema=z.discriminatedUnion("action",[
  z.object({...key,action:z.literal("receive"),orderId:id,supplierId:id,materialId:id,locationId:id,colorName:id,qty,reference:id,occurredOn:id,basis,purchaseDraftId:z.string().max(120).default(""),inboundLotId:z.string().max(120).default("")}),
  z.object({...key,action:z.literal("value_receipt"),id,expectedVersion:z.number().int().positive(),currency:z.string().length(3),unitPrice:qty,basis}),
  z.object({...key,action:z.literal("return_supplier"),id,lotId:id,qty,basis}),
  z.object({...key,action:z.literal("return_use"),id,qty,basis,reverse:z.boolean().default(false)}),
  z.object({...key,action:z.literal("reverse_event"),id,basis}),
  z.object({...key,action:z.literal("reverse_transfer"),id,basis}),
  z.object({...key,action:z.literal("reverse_receipt"),id,expectedVersion:z.number().int().positive(),basis}),
  z.object({...key,action:z.literal("assign_use"),id,orderId:id,basis}),
  z.object({...key,action:z.literal("value_use"),id,expectedVersion:z.number().int().positive(),currency:z.string().length(3),unitPrice:qty,basis}),
  z.object({...key,action:z.literal("sync_payable"),id,expectedVersion:z.number().int().positive(),billId:id,expectedBillVersion:z.number().int().positive(),basis}),
  z.object({...key,action:z.literal("release_reservation"),id,orderId:id,qty,basis}),
  z.object({...key,action:z.literal("tag_cost"),id,kind:z.enum(["freight","other"]),active:z.boolean(),basis}),
]);
export type MaterialCommand=z.infer<typeof MaterialCommandSchema>;
