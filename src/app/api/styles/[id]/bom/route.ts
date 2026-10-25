import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { saveStyleBomDraft } from "@/server/services/style-bom";

const Schema = z.object({
  materialIds: z.array(z.string()).default([]),
  consumptions: z.record(z.string(), z.string()).optional(),
});

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const { id } = await context.params;
  const parsed = Schema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "请选择面辅料" }, { status: 400 });
  try {
    const result = await saveStyleBomDraft({
      organizationId: session.organizationId,
      userId: session.id,
      role: session.role,
      styleId: id,
      materialIds: parsed.data.materialIds,
      consumptions: parsed.data.consumptions,
    });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "保存失败" }, { status: 400 });
  }
}
