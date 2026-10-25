import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { updateMaterialCard } from "@/server/services/material-create";

const Schema = z.object({
  specSummary: z.string().optional(),
  composition: z.string().optional(),
  gsm: z.string().optional(),
  widthCm: z.string().optional(),
});

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const { id } = await context.params;
  const parsed = Schema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "材料卡片字段无效" }, { status: 400 });
  try {
    const result = await updateMaterialCard({
      organizationId: session.organizationId,
      userId: session.id,
      role: session.role,
      materialId: id,
      ...parsed.data,
    });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "更新失败" }, { status: 400 });
  }
}
