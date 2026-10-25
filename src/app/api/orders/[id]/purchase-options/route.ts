import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { ExecutionError } from "@/server/services/execution";
import { adoptPurchaseOption } from "@/server/services/adopt-purchase-option";

const Schema = z.object({
  materialId: z.string().min(1),
  optionCode: z.enum(["A", "B"]),
  expectedSnapshot: z.string().regex(/^[a-f0-9]{64}$/),
});

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const { id } = await context.params;
  const parsed = Schema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "请选择方案 A 或 B，并刷新获取当前预览" }, { status: 400 });
  try {
    const result = await adoptPurchaseOption({
      organizationId: session.organizationId,
      userId: session.id,
      role: session.role,
      orderId: id,
      materialId: parsed.data.materialId,
      optionCode: parsed.data.optionCode,
      expectedSnapshot: parsed.data.expectedSnapshot,
    });
    return NextResponse.json({
      ...result,
      message: result.reused
        ? `方案 ${parsed.data.optionCode} 已采用，未重复占库，未下达采购`
        : `已采用方案 ${parsed.data.optionCode}：占用余料 ${result.allocatedFree} 米，采购草稿 ${result.purchaseDraft.qty} 米，未下达采购`,
    });
  } catch (error) {
    const status = error instanceof ExecutionError && /占用|重算|已采用/.test(error.message) ? 409 : 400;
    return NextResponse.json({ error: error instanceof Error ? error.message : "采用失败" }, { status });
  }
}
