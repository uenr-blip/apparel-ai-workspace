import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { createStyleOption } from "@/server/services/style-catalog";

const Schema = z.object({
  kind: z.enum(["brand", "category", "type", "year"]),
  name: z.string().min(1),
  parentId: z.string().min(1).optional().nullable(),
});

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const parsed = Schema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "请填写要加入的名称" }, { status: 400 });
  try {
    const option = await createStyleOption({
      organizationId: session.organizationId,
      userId: session.id,
      role: session.role,
      kind: parsed.data.kind,
      name: parsed.data.name,
      parentId: parsed.data.parentId,
    });
    return NextResponse.json({
      id: option.id,
      name: option.name,
      kind: option.kind,
      parentId: option.parentId,
      parentName: option.parent?.name ?? null,
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "增加失败" }, { status: 400 });
  }
}
