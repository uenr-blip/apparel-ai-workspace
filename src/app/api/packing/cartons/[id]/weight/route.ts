import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { ExecutionError } from "@/server/services/execution";
import { recordCartonWeight } from "@/server/services/packing";

const Schema = z.object({
  netWeight: z.string().optional(),
  grossWeight: z.string().optional(),
  claimed: z.enum(["estimated", "measured"]),
});

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const { id } = await context.params;
  const parsed = Schema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "请选择实测或估算" }, { status: 400 });
  try {
    const result = await recordCartonWeight({
      organizationId: session.organizationId,
      userId: session.id,
      role: session.role,
      factoryId: session.factoryId,
      cartonId: id,
      netWeight: parsed.data.netWeight,
      grossWeight: parsed.data.grossWeight,
      claimed: parsed.data.claimed,
    });
    return NextResponse.json({
      ...result,
      message: result.carton.weightStatus === "measured" ? "已记实测重量" : result.carton.weightStatus === "estimated" ? "已记估算重量" : "仍为待称重",
    });
  } catch (error) {
    const status = error instanceof ExecutionError && /无权|不存在/.test(error.message) ? 403 : 400;
    return NextResponse.json({ error: error instanceof Error ? error.message : "称重失败" }, { status });
  }
}
