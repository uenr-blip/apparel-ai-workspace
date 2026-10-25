import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { removeDesigner } from "@/server/services/designer";

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const { id } = await context.params;
  try {
    const result = await removeDesigner({
      organizationId: session.organizationId,
      userId: session.id,
      role: session.role,
      designerId: id,
    });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "移除失败" }, { status: 400 });
  }
}
