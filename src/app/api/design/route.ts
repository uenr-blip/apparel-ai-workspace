import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { createDesignProject } from "@/server/services/design-studio";

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const body = (await request.json()) as {
    name?: string;
    brief?: string;
    intent?: string;
    styleId?: string;
    materialId?: string;
  };
  try {
    const project = await createDesignProject({
      organizationId: session.organizationId,
      userId: session.id,
      role: session.role,
      name: String(body.name ?? ""),
      brief: body.brief,
      intent: body.intent,
      styleId: body.styleId || null,
      materialId: body.materialId || null,
    });
    return NextResponse.json(project);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "创建失败" }, { status: 400 });
  }
}
