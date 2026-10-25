import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { ExecutionError } from "@/server/services/execution";
import { createPackingDraft } from "@/server/services/packing";

const Schema = z.object({
  cartons: z
    .array(
      z.object({
        cartonNo: z.string().min(1),
        lines: z
          .array(
            z.object({
              colorName: z.string().min(1),
              sizeCode: z.string(),
              quantity: z.number().int().positive(),
            }),
          )
          .min(1),
      }),
    )
    .min(1),
  idempotencyKey: z.string().min(1),
  note: z.string().optional(),
});

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const { id } = await context.params;
  const parsed = Schema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "请填写箱号、颜色尺码件数和幂等键" }, { status: 400 });
  try {
    const result = await createPackingDraft({
      organizationId: session.organizationId,
      userId: session.id,
      role: session.role,
      factoryId: session.factoryId,
      orderId: id,
      cartons: parsed.data.cartons,
      idempotencyKey: parsed.data.idempotencyKey,
      note: parsed.data.note,
    });
    return NextResponse.json({
      ...result,
      message: result.reused ? "同一幂等键已保存，未重复建稿" : "装箱草稿已保存，未算出运",
    });
  } catch (error) {
    const status = error instanceof ExecutionError && /无权|不存在/.test(error.message) ? 403 : 400;
    return NextResponse.json({ error: error instanceof Error ? error.message : "保存失败" }, { status });
  }
}
