import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { ExecutionError } from "@/server/services/execution";
import { assignOrderFactory } from "@/server/services/order-board";

const Schema = z.object({
  factoryId: z.string().nullable(),
});

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const { id } = await context.params;
  const parsed = Schema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "请选择工厂或未指定" }, { status: 400 });
  try {
    const result = await assignOrderFactory({
      organizationId: session.organizationId,
      userId: session.id,
      role: session.role,
      orderId: id,
      factoryId: parsed.data.factoryId,
    });
    return NextResponse.json({
      ...result,
      message: result.reused ? "工厂未变化" : "已指派工厂",
    });
  } catch (error) {
    const status = error instanceof ExecutionError && /无权|不存在/.test(error.message) ? 403 : 400;
    return NextResponse.json({ error: error instanceof Error ? error.message : "指派失败" }, { status });
  }
}
