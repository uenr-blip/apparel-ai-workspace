import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { assignStyleCatalog } from "@/server/services/style-catalog";

const Schema = z.object({
  brandOptionId: z.string().min(1).nullable().optional(),
  categoryOptionId: z.string().min(1).nullable().optional(),
  typeOptionId: z.string().min(1).nullable().optional(),
  yearOptionId: z.string().min(1).nullable().optional(),
});

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const { id } = await context.params;
  const parsed = Schema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "资料选项不完整" }, { status: 400 });
  try {
    const result = await assignStyleCatalog({
      organizationId: session.organizationId,
      userId: session.id,
      role: session.role,
      styleId: id,
      ...parsed.data,
    });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "更新失败" }, { status: 400 });
  }
}
