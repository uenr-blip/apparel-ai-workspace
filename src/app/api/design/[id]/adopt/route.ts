import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { adoptDesignDraft } from "@/server/services/design-studio";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const { id } = await context.params;
  const body = (await request.json()) as { target?: "development" | "style" };
  try {
    const result = await adoptDesignDraft({
      organizationId: session.organizationId,
      userId: session.id,
      role: session.role,
      projectId: id,
      target: body.target === "style" ? "style" : "development",
    });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "转入失败" }, { status: 400 });
  }
}
