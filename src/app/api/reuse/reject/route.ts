import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { checkTradeOrigin, boundedBody } from "@/server/services/trade-http";
import { TradeError } from "@/lib/trade-money";
import { rejectReuseCandidate } from "@/server/services/reuse";

const Schema = z.object({
  query: z.string().min(1).max(2000),
  candidateKind: z.enum(["style", "material"]),
  candidateId: z.string().min(1).max(100),
  reason: z.string().trim().min(1).max(2000),
}).strict();

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "未登录" }, { status: 401 });
  try {
    checkTradeOrigin(request);
    const parsed = Schema.safeParse(JSON.parse((await boundedBody(request, 8192)).toString("utf8")));
  if (!parsed.success) return NextResponse.json({ error: "拒绝需要原因" }, { status: 400 });
    const result = await rejectReuseCandidate({
      organizationId: session.organizationId,
      userId: session.id,
      ...parsed.data,
    });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error && !error.name.startsWith("Prisma") ? error.message : "拒绝失败" }, { status: error instanceof TradeError ? error.status : 400 });
  }
}
