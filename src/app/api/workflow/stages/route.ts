import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { tradeSession, tradeHttpError, checkTradeOrigin, boundedBody } from "@/server/services/trade-http";
import { previewStageTransfer, confirmStageTransfer, markStageRead, previewStageMaterialSource, adoptStageMaterialSource } from "@/server/services/workflow-stage";
import { ExecutionError } from "@/server/services/execution";
const Request = z.discriminatedUnion("action", [
  z.object({ action: z.literal("preview"), input: z.unknown() }),
  z.object({ action: z.literal("confirm"), input: z.unknown(), expectedStamp: z.string(), requestKey: z.string(), confirmed: z.boolean() }),
  z.object({ action: z.literal("read"), stageId: z.string(), auditIds: z.array(z.string()).max(100) }),
  z.object({ action: z.literal("previewMaterials"), input: z.unknown() }),
  z.object({ action: z.literal("adoptMaterials"), input: z.unknown(), expectedStamp: z.string(), requestKey: z.string(), confirmed: z.boolean() }),
]);
export async function POST(request: globalThis.Request) {
  try {
    const actor = await tradeSession(); checkTradeOrigin(request);
    const input = Request.parse(JSON.parse((await boundedBody(request, 100 * 1024)).toString()));
    if (input.action === "previewMaterials") return NextResponse.json(await previewStageMaterialSource(actor, input.input));
    if (input.action === "adoptMaterials") return NextResponse.json(await adoptStageMaterialSource(actor, input.input, input.expectedStamp, input.requestKey, input.confirmed));
    return NextResponse.json(input.action === "read" ? await markStageRead(actor, input.stageId, input.auditIds) : input.action === "preview" ? await previewStageTransfer(actor, input.input) : await confirmStageTransfer(actor, input.input, input.expectedStamp, input.requestKey, input.confirmed));
  } catch(e) { if (e instanceof ExecutionError || e instanceof ZodError) return NextResponse.json({ error: e instanceof ZodError ? e.issues[0]?.message : e.message }, { status: 400 }); return tradeHttpError(e); }
}
