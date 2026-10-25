import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { assignStyleDesigner } from "@/server/services/designer";

const Schema = z.object({ designerId: z.string().min(1).nullable() });

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const { id } = await context.params;
  const parsed = Schema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "请选择设计师" }, { status: 400 });
  try {
    const result = await assignStyleDesigner({
      organizationId: session.organizationId,
      userId: session.id,
      role: session.role,
      styleId: id,
      designerId: parsed.data.designerId,
    });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "署名失败" }, { status: 400 });
  }
}
