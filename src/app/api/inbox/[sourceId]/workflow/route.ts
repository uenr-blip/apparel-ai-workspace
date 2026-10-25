import { NextResponse } from "next/server";
import { z } from "zod";
import { tradeSession, checkTradeOrigin, boundedBody } from "@/server/services/trade-http";
import { TradeError } from "@/lib/trade-money";
import { IntakeDraft } from "@/lib/customer-intake";
import { prepareCustomerIntake, saveIntakeDraft, confirmIntakeDraft } from "@/server/services/customer-intake";
const Schema = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("prepare"), useModel: z.boolean() }).strict(),
  z.object({ operation: z.literal("save"), jobId: z.string().nullable(), expectedProposalId: z.string().nullable(), draft: IntakeDraft }).strict(),
  z.object({ operation: z.literal("confirm"), proposalId: z.string(), revision: z.string(), confirmed: z.boolean() }).strict(),
]);
export async function POST(request: Request, context: { params: Promise<{ sourceId: string }> }) {
  try {
    const actor = await tradeSession(); checkTradeOrigin(request);
    const { sourceId } = await context.params;
    const input = Schema.parse(JSON.parse((await boundedBody(request, 100000)).toString("utf8")));
    const result = input.operation === "prepare" ? await prepareCustomerIntake(actor, sourceId, input)
      : input.operation === "save" ? await saveIntakeDraft(actor, { ...input, sourceId }) : await confirmIntakeDraft(actor, { ...input, sourceId });
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ error: e instanceof z.ZodError ? "请检查表格字段、日期和数量格式" : e instanceof Error && !e.name.startsWith("Prisma") ? e.message : "操作未完成，请刷新核对后重试" }, { status: e instanceof TradeError ? e.status : 400 });
  }
}
