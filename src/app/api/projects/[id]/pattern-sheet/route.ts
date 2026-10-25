import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { savePatternSheet } from "@/server/services/craft-sheet";
import { boundedBody, checkTradeOrigin, tradeHttpError } from "@/server/services/trade-http";
import { PatternError } from "@/server/services/pattern-workflow";
import { ExecutionError } from "@/server/services/execution";

const Schema = z.object({
  expectedUpdatedAt: z.string(),
  idempotencyKey: z.string().min(1),
  origin: z.unknown().optional(),
  originNote: z.unknown().optional(),
  craftFamily: z.enum(["sweater", "knit", "woven"]),
  sweater: z.unknown().optional(),
  fabric: z.unknown().optional(),
  references: z.unknown().optional(), reason: z.string().max(400).optional(), contextStamp: z.string().optional(),
  choiceVisibility: z.unknown().optional(),
}).strict();

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const { id } = await context.params;
  try {
    checkTradeOrigin(request);
    const parsed = Schema.safeParse(JSON.parse((await boundedBody(request, 60000)).toString("utf8")));
    if (!parsed.success) return NextResponse.json({ error: "版单没有提交完整" }, { status: 400 });
    const result = await savePatternSheet({
      organizationId: session.organizationId,
      userId: session.id,
      role: session.role,
      projectId: id,
      ...parsed.data,
    });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof PatternError || error instanceof ExecutionError) return NextResponse.json({ error:error.message }, { status:400 });
    if (error instanceof z.ZodError) return NextResponse.json({ error:"版单参数、参考或候选设置不完整，请核对后重试" }, { status:400 });
    return tradeHttpError(error);
  }
}
