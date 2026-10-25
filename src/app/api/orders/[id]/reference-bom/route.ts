import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { ExecutionError } from "@/server/services/execution";
import { referenceApprovedMaterials } from "@/server/services/order-prep";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const { id } = await context.params;
  try {
    const result = await referenceApprovedMaterials({
      organizationId: session.organizationId,
      userId: session.id,
      role: session.role,
      orderId: id,
    });
    return NextResponse.json({
      ...result,
      message: `已把已批准面辅料 ${result.copied} 行引用到本单草稿，未覆盖已批准版本，未下达采购`,
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "引用失败" }, { status: error instanceof ExecutionError ? 400 : 500 });
  }
}
