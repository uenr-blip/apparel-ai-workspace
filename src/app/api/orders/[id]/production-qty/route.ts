import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { ExecutionError } from "@/server/services/execution";
import { recordProductionQty } from "@/server/services/production-board";

const Schema = z
  .object({
    kind: z.enum(["started", "scrapped", "wip", "good", "rework"]),
    quantity: z.number().int().positive().optional(),
    idempotencyKey: z.string().min(1),
    note: z.string().optional(),
    lines: z
      .array(
        z.object({
          colorName: z.string(),
          sizeCode: z.string().optional(),
          quantity: z.number().int().positive(),
        }),
      )
      .optional(),
  })
  .refine((value) => (value.lines && value.lines.length > 0) || value.quantity, {
    message: "请填写产量类型、色尺件数和幂等键",
  });

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const { id } = await context.params;
  const parsed = Schema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "请填写产量类型、色尺件数和幂等键" }, { status: 400 });
  try {
    const result = await recordProductionQty({
      organizationId: session.organizationId,
      userId: session.id,
      role: session.role,
      factoryId: session.factoryId,
      orderId: id,
      kind: parsed.data.kind,
      quantity: parsed.data.quantity,
      idempotencyKey: parsed.data.idempotencyKey,
      note: parsed.data.note,
      lines: parsed.data.lines,
    });
    return NextResponse.json({
      ...result,
      message: result.reused ? "同一幂等键已登记，未重复记账" : "产量已登记",
    });
  } catch (error) {
    const status = error instanceof ExecutionError && /无权|不存在/.test(error.message) ? 403 : 400;
    return NextResponse.json({ error: error instanceof Error ? error.message : "登记失败" }, { status });
  }
}
