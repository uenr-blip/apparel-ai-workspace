import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { createDesigner } from "@/server/services/designer";

const Schema = z.object({ name: z.string().min(1) });

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const parsed = Schema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "请填写设计师姓名" }, { status: 400 });
  try {
    const designer = await createDesigner({
      organizationId: session.organizationId,
      userId: session.id,
      role: session.role,
      name: parsed.data.name,
    });
    return NextResponse.json({ id: designer.id, name: designer.name });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "增加失败" }, { status: 400 });
  }
}
