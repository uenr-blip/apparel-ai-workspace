import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { OrderPrepConflictError } from "@/server/services/order-prep";
import { approveOrderSpec } from "@/server/services/style-version";

const Schema = z.object({
  expectedUpdatedAt: z.string().min(1),
});

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const { id } = await context.params;
  const parsed = Schema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "请刷新后重试，缺少版本时间" }, { status: 400 });
  try {
    const result = await approveOrderSpec({
      organizationId: session.organizationId,
      userId: session.id,
      role: session.role,
      orderId: id,
      expectedUpdatedAt: parsed.data.expectedUpdatedAt,
    });
    return NextResponse.json(result);
  } catch (error) {
    const status = error instanceof OrderPrepConflictError ? 409 : 400;
    return NextResponse.json({ error: error instanceof Error ? error.message : "批准失败" }, { status });
  }
}
