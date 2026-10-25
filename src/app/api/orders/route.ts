import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { ExecutionError } from "@/server/services/execution";
import { createOralOrderDraft } from "@/server/services/oral-order";

const Schema = z.object({
  customerId: z.string().min(1),
  styleId: z.string().min(1),
  factoryId: z.string().nullable().optional(),
  colors: z.array(z.object({ colorName: z.string(), quantity: z.number() })).min(1),
  externalCustomerPo: z.string().nullable().optional(),
  deliveryText: z.string().nullable().optional(),
  note: z.string().nullable().optional(),
  idempotencyKey: z.string().min(8),
});

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const parsed = Schema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "请选择客户、款号，并填写颜色件数" }, { status: 400 });
  try {
    const result = await createOralOrderDraft({
      organizationId: session.organizationId,
      userId: session.id,
      role: session.role,
      customerId: parsed.data.customerId,
      styleId: parsed.data.styleId,
      factoryId: parsed.data.factoryId,
      colors: parsed.data.colors,
      externalCustomerPo: parsed.data.externalCustomerPo,
      deliveryText: parsed.data.deliveryText,
      note: parsed.data.note,
      idempotencyKey: parsed.data.idempotencyKey,
    });
    return NextResponse.json(result);
  } catch (error) {
    const status = error instanceof ExecutionError && /无权/.test(error.message) ? 403 : 400;
    return NextResponse.json({ error: error instanceof Error ? error.message : "建单失败" }, { status });
  }
}
