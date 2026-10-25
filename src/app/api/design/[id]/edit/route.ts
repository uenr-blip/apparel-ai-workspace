import { NextResponse } from "next/server";
import { z } from "zod";
import { editDesignRound, DesignStudioError } from "@/server/services/design-studio";
import { ImageModelError } from "@/server/ai/image";
import { tradeSession, checkTradeOrigin, boundedBody, tradeHttpError } from "@/server/services/trade-http";
const Body = z.object({ instruction: z.string().trim().min(1).max(1000), prompt: z.string().trim().max(2000).optional() }).strict();
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = await tradeSession(); checkTradeOrigin(request);
    const body = Body.parse(JSON.parse((await boundedBody(request, 16000)).toString("utf8")));
    return NextResponse.json(await editDesignRound({ ...actor, projectId: (await context.params).id, ...body }), { headers: { "Cache-Control": "no-store" } });
  } catch(e) {
    if (e instanceof z.ZodError || e instanceof DesignStudioError || e instanceof ImageModelError) return NextResponse.json({ error: e instanceof z.ZodError ? "请检查修改要求" : e.message }, { status: 400 });
    return tradeHttpError(e);
  }
}
