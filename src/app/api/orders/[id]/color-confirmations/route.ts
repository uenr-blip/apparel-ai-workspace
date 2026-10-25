import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { submitColorConfirmation } from "@/server/services/color-confirm";

const Schema = z.object({
  materialId: z.string().min(1),
  colorName: z.string().min(1),
  status: z.enum(["approved", "rejected"]),
  evidence: z.string(),
});

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const { id } = await context.params;
  const parsed = Schema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "请填写颜色、结果和依据" }, { status: 400 });
  try {
    const result = await submitColorConfirmation({
      organizationId: session.organizationId,
      userId: session.id,
      role: session.role,
      orderId: id,
      materialId: parsed.data.materialId,
      colorName: parsed.data.colorName,
      status: parsed.data.status,
      evidence: parsed.data.evidence,
    });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "保存失败" }, { status: 400 });
  }
}
