import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { ExecutionError } from "@/server/services/execution";
import { shipPackingPlan } from "@/server/services/packing";

const Schema = z.object({
  idempotencyKey: z.string().min(1),
});

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const { id } = await context.params;
  const parsed = Schema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "缺少幂等键" }, { status: 400 });
  try {
    const result = await shipPackingPlan({
      organizationId: session.organizationId,
      userId: session.id,
      role: session.role,
      factoryId: session.factoryId,
      planId: id,
      idempotencyKey: parsed.data.idempotencyKey,
    });
    return NextResponse.json({
      ...result,
      message: result.reused ? "该装箱方案已出运" : "已确认出运",
    });
  } catch (error) {
    const status = error instanceof ExecutionError && /无权|不存在/.test(error.message) ? 403 : 400;
    return NextResponse.json({ error: error instanceof Error ? error.message : "出运失败" }, { status });
  }
}
