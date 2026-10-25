import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { ExecutionError, releaseToProduction } from "@/server/services/execution";

const Schema = z.object({
  expectedUpdatedAt: z.string().min(1).optional(),
});

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const { id } = await context.params;
  const parsed = Schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "请刷新后重试" }, { status: 400 });
  try {
    const result = await releaseToProduction({
      organizationId: session.organizationId,
      userId: session.id,
      role: session.role,
      orderId: id,
      expectedUpdatedAt: parsed.data.expectedUpdatedAt,
    });
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "批准投产失败";
    const status = error instanceof ExecutionError && /无权|不存在/.test(message) ? 403 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
