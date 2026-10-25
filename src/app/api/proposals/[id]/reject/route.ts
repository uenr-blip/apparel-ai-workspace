import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { rejectProposal } from "@/server/services/execution";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const { id } = await context.params;
  try {
    const result = await rejectProposal({
      organizationId: session.organizationId,
      userId: session.id,
      role: session.role,
      proposalId: id,
    });
    return NextResponse.json({ ...result, message: result.reused ? "提案已拒绝" : "已拒绝，未写入业务记录" });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "拒绝失败" }, { status: 400 });
  }
}
