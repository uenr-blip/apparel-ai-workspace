import { NextResponse } from "next/server";
import { z } from "zod";
import { generateDesignRound, DesignStudioError } from "@/server/services/design-studio";
import { ImageModelError } from "@/server/ai/image";
import { tradeSession, checkTradeOrigin, boundedBody, tradeHttpError } from "@/server/services/trade-http";
const Body = z.object({ prompt: z.string().trim().min(1).max(2000), instruction: z.string().trim().max(1000).optional(), intent: z.enum(["reference", "recolor", "edit", "onbody"]).optional(), count: z.number().int().min(1).max(4).optional() }).strict();
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = await tradeSession(); checkTradeOrigin(request);
    const body = Body.parse(JSON.parse((await boundedBody(request, 16000)).toString("utf8")));
    return NextResponse.json(await generateDesignRound({ ...actor, projectId: (await context.params).id, ...body }), { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    if (e instanceof z.ZodError || e instanceof DesignStudioError || e instanceof ImageModelError) return NextResponse.json({ error: e instanceof z.ZodError ? "请检查生成要求和图片数量" : e.message }, { status: 400 });
    return tradeHttpError(e);
  }
}
