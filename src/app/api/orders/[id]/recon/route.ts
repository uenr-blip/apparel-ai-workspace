import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { ExecutionError } from "@/server/services/execution";
import { generateFactoryReconDraft } from "@/server/services/recon";

const Schema = z.object({
  idempotencyKey: z.string().min(1),
  expectedSnapshot: z.string().regex(/^[a-f0-9]{64}$/),
  unitPriceYuan: z.string().max(32).nullable().optional(),
  basisNote: z.string().max(1000).optional(),
});

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const { id } = await context.params;
  const parsed = Schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "请刷新预览并填写对账依据" }, { status: 400 });
  try {
    const result = await generateFactoryReconDraft({
      organizationId: session.organizationId,
      userId: session.id,
      role: session.role,
      factoryId: session.factoryId,
      orderId: id,
      idempotencyKey: parsed.data.idempotencyKey,
      expectedSnapshot: parsed.data.expectedSnapshot,
      unitPriceYuan: parsed.data.unitPriceYuan,
      basisNote: parsed.data.basisNote,
    });
    return NextResponse.json({
      ...result,
      message: result.draft.status === "needs_basis" ? "对账基准待核实，未编造金额，不是付款" : "对账草稿已生成，不是付款",
    });
  } catch (error) {
    const status = error instanceof ExecutionError && /无权|不存在/.test(error.message) ? 403 : 400;
    return NextResponse.json({ error: error instanceof Error ? error.message : "对账失败" }, { status });
  }
}
