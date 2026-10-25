import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { linkStyleSeason } from "@/server/services/season";

const Schema = z.object({ seasonId: z.string().min(1) });

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const { id } = await context.params;
  const parsed = Schema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "请选择季节" }, { status: 400 });
  try {
    const result = await linkStyleSeason({
      organizationId: session.organizationId,
      userId: session.id,
      role: session.role,
      styleId: id,
      seasonId: parsed.data.seasonId,
    });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "挂接失败" }, { status: 400 });
  }
}
