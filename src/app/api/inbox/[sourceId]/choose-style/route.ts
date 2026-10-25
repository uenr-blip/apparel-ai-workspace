import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { chooseStyleCandidate } from "@/server/services/intake";

const Schema = z.object({
  styleId: z.string().min(1),
});

export async function POST(request: Request, context: { params: Promise<{ sourceId: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const { sourceId } = await context.params;
  const parsed = Schema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "请选择一份历史资料" }, { status: 400 });
  try {
    const result = await chooseStyleCandidate({
      organizationId: session.organizationId,
      userId: session.id,
      role: session.role,
      sourceId,
      styleId: parsed.data.styleId,
    });
    return NextResponse.json({ proposalId: result.proposal.id, tasks: result.tasks });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "选定失败" }, { status: 400 });
  }
}
