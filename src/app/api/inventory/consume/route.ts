import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { consumeInventory } from "@/server/services/inventory-move";

const Schema = z.object({
  lotId: z.string().min(1),
  qty: z.string().min(1),
  idempotencyKey: z.string().min(1),
  note: z.string().optional(),
  orderId: z.string().min(1).max(120).optional(),
});

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const parsed = Schema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "请填写批次、数量和幂等键" }, { status: 400 });
  try {
    const result = await consumeInventory({
      organizationId: session.organizationId,
      userId: session.id,
      role: session.role,
      factoryId: session.factoryId,
      ...parsed.data,
    });
    return NextResponse.json({
      ...result,
      message: result.reused ? "同一幂等键已领用，未重复过账" : `已领用，未耗用 ${result.companyOnHand}，未改写调拨`,
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "领用失败" }, { status: 400 });
  }
}
