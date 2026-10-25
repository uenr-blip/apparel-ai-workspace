import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { ExecutionError } from "@/server/services/execution";
import { issuePurchaseOrder } from "@/server/services/issue-purchase";

const Schema = z.object({
  materialId: z.string().min(1),
  expectedUpdatedAt: z.string().min(1),
  idempotencyKey: z.string().min(1).max(120),
});

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const { id } = await context.params;
  const parsed = Schema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "请刷新后重试下达采购" }, { status: 400 });
  try {
    const result = await issuePurchaseOrder({
      organizationId: session.organizationId,
      userId: session.id,
      role: session.role,
      orderId: id,
      materialId: parsed.data.materialId,
      expectedUpdatedAt: parsed.data.expectedUpdatedAt,
      idempotencyKey: parsed.data.idempotencyKey,
    });
    return NextResponse.json({
      ...result,
      message: result.reused
        ? `采购单已下达 ${result.qty} 米，未重复下达，未收料，未付款`
        : `已下达采购 ${result.qty} 米 / ${result.amountYuan} 元，未收料，未付款`,
    });
  } catch (error) {
    const status = error instanceof ExecutionError && /变化|刷新/.test(error.message) ? 409 : 400;
    return NextResponse.json({ error: error instanceof Error ? error.message : "下达失败" }, { status });
  }
}
