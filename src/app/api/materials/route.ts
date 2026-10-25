import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { createMaterialMaster } from "@/server/services/material-create";

const Schema = z.object({
  code: z.string(),
  name: z.string(),
  kind: z.enum(["fabric", "yarn", "trim"]),
  specSummary: z.string().optional(),
  unit: z.string().optional(),
  composition: z.string().optional(),
  gsm: z.string().optional(),
  widthCm: z.string().optional(),
});

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const parsed = Schema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "请填写货号、名称和种类" }, { status: 400 });
  try {
    const result = await createMaterialMaster({
      organizationId: session.organizationId,
      userId: session.id,
      role: session.role,
      ...parsed.data,
    });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "建档失败" }, { status: 400 });
  }
}
