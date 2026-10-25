import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { ExecutionError } from "@/server/services/execution";
import { applyInboundEtaChange } from "@/server/services/purchase-options";

const Schema = z.object({
  lotId: z.string().min(1),
  inboundEta: z.string().min(1),
  expectedEta: z.string(),
});

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const { id } = await context.params;
  const parsed = Schema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "请提供在途批次和日期" }, { status: 400 });
  try {
    await applyInboundEtaChange({
      organizationId: session.organizationId,
      userId: session.id,
      role: session.role,
      orderId: id,
      lotId: parsed.data.lotId,
      inboundEta: parsed.data.inboundEta,
      expectedEta: parsed.data.expectedEta,
    });
    return NextResponse.json({ message: "在途日期已核验，未下达采购" });
  } catch (error) {
    const status = error instanceof ExecutionError && error.message.includes("他人修改") ? 409 : 400;
    return NextResponse.json({ error: error instanceof Error ? error.message : "核验失败" }, { status });
  }
}
