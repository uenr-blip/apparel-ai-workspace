import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { OrderPrepConflictError, saveOrderPrep } from "@/server/services/order-prep";

const BreakdownValue = z.union([z.number(), z.string(), z.null()]).optional();

const Schema = z.object({
  sizes: z
    .array(
      z.object({
        colorName: z.string(),
        breakdown: z.record(z.string(), BreakdownValue),
      }),
    )
    .default([]),
  confirmedDeliveryDate: z.string().nullable().optional(),
  ribSpec: z.string().nullable().optional(),
  expectedUpdatedAt: z.string().min(1),
  newColors: z
    .array(
      z.object({
        colorName: z.string().min(1),
        quantity: z.number().int().positive(),
      }),
    )
    .optional(),
});

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const { id } = await context.params;
  const parsed = Schema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "请提供订单资料，并带上当前版本时间以防冲突" }, { status: 400 });
  }
  try {
    const result = await saveOrderPrep({
      organizationId: session.organizationId,
      userId: session.id,
      role: session.role,
      orderId: id,
      sizes: parsed.data.sizes,
      newColors: parsed.data.newColors,
      confirmedDeliveryDate: parsed.data.confirmedDeliveryDate,
      ribSpec: parsed.data.ribSpec,
      expectedUpdatedAt: parsed.data.expectedUpdatedAt,
    });
    return NextResponse.json(result);
  } catch (error) {
    const status = error instanceof OrderPrepConflictError ? 409 : 400;
    return NextResponse.json({ error: error instanceof Error ? error.message : "保存失败" }, { status });
  }
}
