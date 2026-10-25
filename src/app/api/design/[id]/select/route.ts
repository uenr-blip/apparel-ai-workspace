import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { selectDesignVariants } from "@/server/services/design-studio";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const { id } = await context.params;
  const body = (await request.json()) as { variantIds?: string[] };
  try {
    const project = await selectDesignVariants({
      organizationId: session.organizationId,
      userId: session.id,
      role: session.role,
      projectId: id,
      variantIds: Array.isArray(body.variantIds) ? body.variantIds.map(String) : [],
    });
    return NextResponse.json(project);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "勾选失败" }, { status: 400 });
  }
}
