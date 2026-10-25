import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { openFollowAsOrder } from "@/server/services/order-merch";

const Schema = z.object({
  rowIds: z.array(z.string().min(1)).min(1).max(300).optional(),
  customerId: z.string().min(1),
  expectedUpdatedAt: z.string().datetime(),
  idempotencyKey: z.string().min(1),
});

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const { id } = await context.params;
  const parsed = Schema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "客户和提交标记没有带齐" }, { status: 400 });
  try {
    const result = await openFollowAsOrder({
      organizationId: session.organizationId,
      userId: session.id,
      role: session.role,
      sheetId: id,
      customerId: parsed.data.customerId,
      rowIds: parsed.data.rowIds,
      expectedUpdatedAt: parsed.data.expectedUpdatedAt,
      idempotencyKey: parsed.data.idempotencyKey,
    });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "没有开成生产订单" }, { status: 400 });
  }
}
