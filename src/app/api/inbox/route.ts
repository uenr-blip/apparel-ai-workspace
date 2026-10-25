import { NextResponse } from "next/server";
import { z } from "zod";
import { ingestText } from "@/server/services/intake";
import { prepareCustomerIntake } from "@/server/services/customer-intake";
import { tradeSession, checkTradeOrigin, boundedBody } from "@/server/services/trade-http";
import { TradeError } from "@/lib/trade-money";
const Schema = z.object({ text: z.string().trim().min(4).max(30000), useModel: z.boolean().default(false), origin: z.literal("inbox-paste").optional() }).strict();
export async function POST(request: Request) {
  try {
    const actor = await tradeSession(); checkTradeOrigin(request);
    if (!["salesperson", "manager"].includes(actor.role)) return NextResponse.json({ error: "当前角色不能录入客户资料" }, { status: 403 });
    const input = Schema.parse(JSON.parse((await boundedBody(request, 130000)).toString("utf8")));
    const ingested = await ingestText({ ...actor, text: input.text, origin: "inbox-paste" });
    // A repeated source opens its existing review, rather than consuming the model or resetting an approval.
    if (!ingested.alreadyExisted) await prepareCustomerIntake(actor, ingested.source.id, { useModel: input.useModel });
    return NextResponse.json({ sourceId: ingested.source.id, alreadyExisted: ingested.alreadyExisted });
  } catch (e) { return NextResponse.json({ error: e instanceof z.ZodError ? "请粘贴一个客户 PO 的原文（4–30000字）" : e instanceof Error && !e.name.startsWith("Prisma") ? e.message : "资料未保存，请重试" }, { status: e instanceof TradeError ? e.status : 400 }); }
}
